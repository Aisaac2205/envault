import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { BackupService } from '../backup/backup.service';
import { BackupRepository } from '../backup/backup.repository';
import { R2Service } from '../backup/r2.service';
import { RestoreRepository } from '../restore/restore.repository';
import { ConnectionsService } from '../connections/connections.service';
import { EnrichedR2Object } from '../backup/interfaces/enriched-r2-object.interface';
import { ManualRetentionSettingEntity } from '../../database/entities/manual-retention-setting.entity';
import { ConnectionRetentionPolicyEntity } from '../../database/entities/connection-retention-policy.entity';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { Environment } from '../../database/enums/environment.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { CleanupParamsDto } from './dto/cleanup-params.dto';
import { UpdateManualRetentionDto } from './dto/update-manual-retention.dto';
import {
  CleanupError,
  CleanupPreview,
  CleanupResult,
  ConnectionRetentionPolicy,
  ConnectionRetentionPolicyInput,
  DryRunCandidate,
  RetentionPolicy,
  RetentionPreviewItem,
  RetentionRunItem,
} from './interfaces/retention.interface';
import {
  StorageCategoryUsage,
  StorageConnectionUsage,
  StorageOverview,
} from './interfaces/storage.interface';
import {
  DbHygienePreview,
  DbHygieneResult,
} from './interfaces/db-hygiene.interface';
import {
  OrphanDump,
  ReconcilePreview,
  ReconcileResult,
  StaleDbRow,
} from './interfaces/reconcile.interface';
import { RETENTION_JOB_NAME, RETENTION_QUEUE_NAME } from './maintenance.constants';

const BYTES_PER_MB = 1024 * 1024;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MANUAL_SWEEP_LOCK_ID = 778_716_811;

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly backupRepository: BackupRepository,
    private readonly r2Service: R2Service,
    private readonly restoreRepository: RestoreRepository,
    private readonly connectionsService: ConnectionsService,
    @InjectRepository(ManualRetentionSettingEntity)
    private readonly manualRetentionRepo: Repository<ManualRetentionSettingEntity>,
    @InjectRepository(ConnectionRetentionPolicyEntity)
    private readonly retentionPolicyRepo: Repository<ConnectionRetentionPolicyEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @Optional()
    @InjectQueue(RETENTION_QUEUE_NAME)
    private readonly retentionQueue?: Queue,
  ) {}

  // --- Ad-hoc cleanup (manual UI) -----------------------------------------

  async previewCleanup(params: CleanupParamsDto): Promise<CleanupPreview> {
    this.assertHasCriterion(params);
    const dryRun = await this.computeDryRun(params.connectionSlug, params.category, params);
    return this.toPreview(dryRun);
  }

  async runCleanup(params: CleanupParamsDto): Promise<CleanupResult> {
    this.assertHasCriterion(params);
    return this.prune(params.connectionSlug, params.category, params);
  }

  // --- Automatic retention (cronjobs / sweeper) ---------------------------

  /**
   * Applies a retention policy to one connection + category. Used by the cron
   * after each scheduled backup and by the manual sweeper. No-op (returns an
   * empty result) when the policy has no criteria.
   */
  async applyRetention(
    connectionSlug: string,
    category: BackupCategory,
    policy: RetentionPolicy,
  ): Promise<CleanupResult> {
    if (!this.hasCriterion(policy)) {
      return { deleted: 0, freedMb: 0, errors: [] };
    }
    return this.prune(connectionSlug, category, policy);
  }

  // --- Global manual-dump retention + daily sweeper -----------------------

  /** Current global manual-dump retention policy (transient default if unset). */
  async getManualRetention(): Promise<ManualRetentionSettingEntity> {
    const existing = await this.manualRetentionRepo.findOne({ where: { id: 1 } });
    return (
      existing ??
      this.manualRetentionRepo.create({
        id: 1,
        enabled: false,
        keepLast: null,
        maxAgeDays: null,
        maxTotalSizeMb: null,
      })
    );
  }

  /** Full-replace of the global manual-dump retention policy (singleton row). */
  async updateManualRetention(
    dto: UpdateManualRetentionDto,
  ): Promise<ManualRetentionSettingEntity> {
    const entity = this.manualRetentionRepo.create({
      id: 1,
      enabled: dto.enabled ?? false,
      keepLast: dto.keepLast ?? null,
      maxAgeDays: dto.maxAgeDays ?? null,
      maxTotalSizeMb: dto.maxTotalSizeMb ?? null,
    });
    return this.manualRetentionRepo.save(entity);
  }

  /**
   * Daily sweep: applies the manual-dump retention policy of every connection.
   * Guarded by a pg advisory lock so only one replica runs it; wrapped so a
   * failure never crashes the process.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweepManualRetention(): Promise<void> {
    try {
      const queryRunner = this.dataSource.createQueryRunner();
      try {
        await queryRunner.connect();
        const lock = await this.dataSource.query<Array<{ acquired: boolean }>>(
          'SELECT pg_try_advisory_lock($1) AS acquired',
          [MANUAL_SWEEP_LOCK_ID],
          queryRunner,
        );
        if (!lock[0]?.acquired) return;

        try {
          const connections = await this.connectionsService.findAll(Environment.PROD);
          const connectionIds = connections.map((c) => c.id);

          const policies = await this.retentionPolicyRepo.find({
            where: { category: BackupCategory.MANUAL },
          });
          const policyByConnectionId = new Map(
            policies
              .filter((p) => p.retentionDays != null && connectionIds.includes(p.connectionId))
              .map((p) => [p.connectionId, p.retentionDays]),
          );

          if (policyByConnectionId.size === 0) return;

          let processedCount = 0;
          for (const connection of connections) {
            const days = policyByConnectionId.get(connection.id);
            if (days == null) continue;

            const policy: RetentionPolicy = { maxAgeDays: days };
            try {
              if (this.retentionQueue) {
                await this.retentionQueue.add(
                  RETENTION_JOB_NAME,
                  { connectionSlug: connection.slug, category: BackupCategory.MANUAL, policy },
                  { removeOnComplete: true },
                );
                processedCount++;
              } else {
                const result = await this.applyRetention(
                  connection.slug,
                  BackupCategory.MANUAL,
                  policy,
                );
                processedCount++;
                if (result.deleted > 0) {
                  this.logger.log(
                    `Manual sweep "${connection.slug}": pruned ${result.deleted} (${result.freedMb} MB)`,
                  );
                }
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.logger.warn(
                `Manual sweep failed for "${connection.slug}": ${message}`,
              );
            }
          }

          if (processedCount > 0) {
            await this.dataSource.query(
              `UPDATE connection_retention_policies SET "updatedAt" = NOW() WHERE category = $1`,
              [BackupCategory.MANUAL],
            );
          }
        } finally {
          try {
            const unlockResult = await this.dataSource.query<Array<{ released: boolean }>>(
              'SELECT pg_advisory_unlock($1) AS released',
              [MANUAL_SWEEP_LOCK_ID],
              queryRunner,
            );
            if (!unlockResult?.[0]?.released) {
              this.logger.error('Manual retention advisory lock release failed');
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Manual retention advisory lock release failed: ${message}`);
          }
        }
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`sweepManualRetention crashed: ${message}`);
    }
  }

  // --- Per-connection retention policy ------------------------------------

  async getRetentionPolicy(
    connectionSlug: string,
    category: BackupCategory,
  ): Promise<ConnectionRetentionPolicy | null> {
    const connection = await this.connectionsService.findBySlug(connectionSlug);
    if (!connection) return null;

    const row = await this.retentionPolicyRepo.findOne({
      where: { connectionId: connection.id, category },
    });

    if (!row) return null;
    return { category: row.category, retentionDays: row.retentionDays };
  }

  async getRetentionPolicies(
    connectionSlug: string,
  ): Promise<ConnectionRetentionPolicy[]> {
    const connection = await this.connectionsService.findBySlug(connectionSlug);
    if (!connection) {
      throw new BadRequestException(`Connection "${connectionSlug}" not found`);
    }

    const rows = await this.retentionPolicyRepo.find({
      where: { connectionId: connection.id },
    });

    return rows.map((r) => ({
      category: r.category,
      retentionDays: r.retentionDays,
    }));
  }

  async updateRetentionPolicies(
    connectionSlug: string,
    policies: ConnectionRetentionPolicyInput[],
  ): Promise<ConnectionRetentionPolicy[]> {
    const connection = await this.connectionsService.findBySlug(connectionSlug);
    if (!connection) {
      throw new BadRequestException(`Connection "${connectionSlug}" not found`);
    }

    const validCategories = Object.values(BackupCategory);
    for (const p of policies) {
      if (!validCategories.includes(p.category)) {
        throw new BadRequestException(`Invalid category: ${p.category}`);
      }
      if (p.retentionDays != null && (!Number.isInteger(p.retentionDays) || p.retentionDays < 1)) {
        throw new BadRequestException(
          `retentionDays for ${p.category} must be an integer >= 1 or null`,
        );
      }
    }

    // Remove existing policies for this connection.
    await this.retentionPolicyRepo.delete({ connectionId: connection.id });

    // Insert new ones (only those with a value; null means keep forever → no row).
    const toInsert = policies
      .filter((p) => p.retentionDays != null)
      .map((p) =>
        this.retentionPolicyRepo.create({
          connectionId: connection.id,
          category: p.category,
          retentionDays: p.retentionDays,
        }),
      );

    if (toInsert.length > 0) {
      await this.retentionPolicyRepo.save(toInsert);
    }

    return this.getRetentionPolicies(connectionSlug);
  }

  async previewRetentionForConnection(
    connectionSlug: string,
  ): Promise<RetentionPreviewItem[]> {
    const policies = await this.getRetentionPolicies(connectionSlug);
    const items: RetentionPreviewItem[] = [];

    for (const policy of policies) {
      if (policy.retentionDays == null) continue;
      const dto: RetentionPolicy = { maxAgeDays: policy.retentionDays };
      const dryRun = await this.computeDryRun(
        connectionSlug,
        policy.category,
        dto,
      );
      items.push({
        category: policy.category,
        count: dryRun.items.length,
        totalSizeMb: this.bytesToMb(dryRun.totalBytes),
        totalBytes: dryRun.totalBytes,
        protectedCount: dryRun.protectedCount,
        candidates: dryRun.candidates,
      });
    }

    return items;
  }

  async runRetentionForConnection(
    connectionSlug: string,
  ): Promise<RetentionRunItem[]> {
    const policies = await this.getRetentionPolicies(connectionSlug);
    const results: RetentionRunItem[] = [];

    for (const policy of policies) {
      if (policy.retentionDays == null) continue;
      const dto: RetentionPolicy = { maxAgeDays: policy.retentionDays };
      const result = await this.prune(connectionSlug, policy.category, dto);
      results.push({
        category: policy.category,
        deleted: result.deleted,
        freedMb: result.freedMb,
        errors: result.errors.length,
      });
    }

    return results;
  }

  // --- Storage overview ---------------------------------------------------

  /** Aggregates R2 dump usage by connection and by category. Read-only. */
  async getStorageOverview(): Promise<StorageOverview> {
    const objects = await this.r2Service.list();
    const dumps = objects.filter((obj) => obj.key.endsWith('.dump'));

    const connections = await this.connectionsService.findAll();
    const nameBySlug = new Map(connections.map((c) => [c.slug, c.name]));

    const byConn = new Map<
      string,
      { count: number; bytes: number; oldest: number | null }
    >();
    const byCat = new Map<string, { count: number; bytes: number }>();
    let totalBytes = 0;

    for (const obj of dumps) {
      const [slug, category] = obj.key.split('/');
      if (!slug || !category) continue;
      totalBytes += obj.size;

      const conn = byConn.get(slug) ?? { count: 0, bytes: 0, oldest: null };
      conn.count += 1;
      conn.bytes += obj.size;
      const ts = obj.lastModified.getTime();
      conn.oldest = conn.oldest === null ? ts : Math.min(conn.oldest, ts);
      byConn.set(slug, conn);

      const cat = byCat.get(category) ?? { count: 0, bytes: 0 };
      cat.count += 1;
      cat.bytes += obj.size;
      byCat.set(category, cat);
    }

    const byConnection: StorageConnectionUsage[] = [...byConn.entries()]
      .map(([slug, v]) => ({
        connectionSlug: slug,
        connectionName: nameBySlug.get(slug) ?? slug,
        count: v.count,
        sizeMb: this.bytesToMb(v.bytes),
        oldest: v.oldest === null ? null : new Date(v.oldest).toISOString(),
      }))
      .sort((a, b) => b.sizeMb - a.sizeMb);

    const byCategory: StorageCategoryUsage[] = [...byCat.entries()]
      .map(([category, v]) => ({
        category: category as BackupCategory,
        count: v.count,
        sizeMb: this.bytesToMb(v.bytes),
      }))
      .sort((a, b) => b.sizeMb - a.sizeMb);

    return {
      totalDumps: dumps.length,
      totalSizeMb: this.bytesToMb(totalBytes),
      byConnection,
      byCategory,
    };
  }

  // --- DB hygiene (prune FAILED job rows) ---------------------------------

  async previewDbHygiene(olderThanDays: number): Promise<DbHygienePreview> {
    const cutoff = new Date(Date.now() - olderThanDays * MS_PER_DAY);
    const failedCount = await this.backupRepository.countFailedOlderThan(cutoff);
    return { failedCount };
  }

  async runDbHygiene(olderThanDays: number): Promise<DbHygieneResult> {
    const cutoff = new Date(Date.now() - olderThanDays * MS_PER_DAY);
    const deleted = await this.backupRepository.deleteFailedOlderThan(cutoff);
    return { deleted };
  }

  // --- Reconciliation (R2 <-> DB drift) -----------------------------------

  /**
   * Detects drift between R2 and the DB. Read-only.
   * - staleDbRows: COMPLETED rows whose dump is gone from R2.
   * - orphanManifests: manifests with no dump sibling.
   * - orphanDumps: dumps with no DB row (hasManifest = restorable vs junk).
   */
  async reconcilePreview(): Promise<ReconcilePreview> {
    const objects = await this.r2Service.list();
    const dumpKeys = new Set(
      objects.filter((o) => o.key.endsWith('.dump')).map((o) => o.key),
    );
    const manifestKeys = new Set(
      objects.filter((o) => o.key.endsWith('.manifest.json')).map((o) => o.key),
    );

    const { data: jobs } = await this.backupRepository.findAll();
    const jobFileKeys = new Set(
      jobs
        .map((j) => j.fileKey)
        .filter((key): key is string => key !== null),
    );

    const staleDbRows: StaleDbRow[] = jobs
      .filter(
        (j) =>
          j.status === JobStatus.COMPLETED &&
          j.fileKey !== null &&
          !dumpKeys.has(j.fileKey),
      )
      .map((j) => ({ id: j.id, fileKey: j.fileKey as string }));

    const orphanDumps: OrphanDump[] = [...dumpKeys]
      .filter((key) => !jobFileKeys.has(key))
      .map((key) => ({
        key,
        hasManifest: manifestKeys.has(key.replace(/\.dump$/, '.manifest.json')),
      }));

    const orphanManifests: string[] = [...manifestKeys].filter(
      (mk) => !dumpKeys.has(mk.replace(/\.manifest\.json$/, '.dump')),
    );

    return { staleDbRows, orphanManifests, orphanDumps };
  }

  /**
   * Cleans only the unambiguously-safe drift: stale DB rows, orphan manifests,
   * and orphan dumps WITHOUT a manifest (failed uploads). Orphan dumps WITH a
   * manifest are restorable and are kept intact. Partial failures are reported.
   */
  async reconcileRun(): Promise<ReconcileResult> {
    const preview = await this.reconcilePreview();
    const errors: CleanupError[] = [];

    const dbRowsDeleted = await this.backupRepository.deleteByIds(
      preview.staleDbRows.map((r) => r.id),
    );

    let manifestsDeleted = 0;
    for (const key of preview.orphanManifests) {
      try {
        await this.r2Service.delete(key);
        manifestsDeleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ key, message });
      }
    }

    let dumpsDeleted = 0;
    let untrackedKept = 0;
    for (const dump of preview.orphanDumps) {
      if (dump.hasManifest) {
        untrackedKept += 1; // restorable — never auto-delete
        continue;
      }
      try {
        await this.r2Service.delete(dump.key);
        dumpsDeleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ key: dump.key, message });
      }
    }

    return {
      dbRowsDeleted,
      manifestsDeleted,
      dumpsDeleted,
      untrackedKept,
      errors,
    };
  }

  // --- Core engine --------------------------------------------------------

  async enqueueRetention(
    connectionSlug: string,
    category: BackupCategory,
    policy: RetentionPolicy,
  ): Promise<{ enqueued: boolean; jobId?: string }> {
    if (this.retentionQueue) {
      const job = await this.retentionQueue.add(
        RETENTION_JOB_NAME,
        { connectionSlug, category, policy },
        { removeOnComplete: true },
      );
      return { enqueued: true, jobId: job.id };
    }
    await this.applyRetention(connectionSlug, category, policy);
    return { enqueued: false };
  }

  private async prune(
    connectionSlug: string,
    category: BackupCategory,
    policy: RetentionPolicy,
  ): Promise<CleanupResult> {
    const { items } = await this.computeDryRun(connectionSlug, category, policy);

    const errors: CleanupError[] = [];
    const successfulKeys: string[] = [];
    let freedBytes = 0;

    // Stage 1: Coordinated physical deletion in remote object storage (Cloudflare R2)
    for (const item of items) {
      let dumpDeleted = false;
      try {
        await this.r2Service.delete(item.key);
        dumpDeleted = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ key: item.key, message });
        continue;
      }

      const manifestKey = item.key.replace(/\.dump$/, '.manifest.json');
      let manifestDeleted = false;
      try {
        await this.r2Service.delete(manifestKey);
        manifestDeleted = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ key: manifestKey, message });
      }

      // Both remote files must be confirmed deleted before database record purge
      if (dumpDeleted && manifestDeleted) {
        successfulKeys.push(item.key);
        freedBytes += item.size;
      }
    }

    // Stage 2: Purge corresponding records from control database
    if (successfulKeys.length > 0) {
      await this.backupRepository.deleteByFileKeys(successfulKeys);
    }

    return {
      deleted: successfulKeys.length,
      freedMb: this.bytesToMb(freedBytes),
      errors,
    };
  }

  /**
   * Computes the non-destructive Dry Run simulation for retention evaluation.
   * Reports candidate dumps, exact sizes, protected floor items, and reasons without mutating storage or DB.
   */
  async computeDryRun(
    connectionSlug: string,
    category: BackupCategory,
    policy: RetentionPolicy,
  ): Promise<{
    candidates: DryRunCandidate[];
    items: EnrichedR2Object[];
    protectedCount: number;
    totalBytes: number;
  }> {
    const dumps = await this.backupService.listEnrichedDumps(connectionSlug, category);
    if (dumps.length === 0) {
      return { candidates: [], items: [], protectedCount: 0, totalBytes: 0 };
    }

    const inUse = await this.getInUseFileKeys();
    const dbJobs = await this.backupRepository.findByFileKeys(dumps.map((d) => d.key));
    const jobByFileKey = new Map(dbJobs.map((j) => [j.fileKey, j.id]));

    const protectedFloor = Math.max(policy.keepLast ?? 0, 1);
    const cutoff =
      policy.maxAgeDays != null ? Date.now() - policy.maxAgeDays * MS_PER_DAY : null;
    const capBytes =
      policy.maxTotalSizeMb != null ? policy.maxTotalSizeMb * BYTES_PER_MB : null;
    const keepLastOnly = policy.maxAgeDays == null && policy.maxTotalSizeMb == null;

    const candidates: DryRunCandidate[] = [];
    const toDeleteItems: EnrichedR2Object[] = [];
    let cumulative = 0;
    let freedBytes = 0;
    let actualProtected = 0;

    dumps.forEach((dump, index) => {
      cumulative += dump.size;
      const jobId = jobByFileKey.get(dump.key) ?? null;

      if (index < protectedFloor) {
        actualProtected++;
        candidates.push({
          fileKey: dump.key,
          sizeBytes: dump.size,
          lastModified: dump.lastModified.toISOString(),
          category: dump.category,
          reason: 'protected_floor',
          jobId,
          isProtected: true,
        });
        return;
      }

      if (inUse.has(dump.key)) {
        actualProtected++;
        candidates.push({
          fileKey: dump.key,
          sizeBytes: dump.size,
          lastModified: dump.lastModified.toISOString(),
          category: dump.category,
          reason: 'protected_active_restore',
          jobId,
          isProtected: true,
        });
        return;
      }

      const tooOld = cutoff != null && dump.lastModified.getTime() < cutoff;
      const overCap = capBytes != null && cumulative > capBytes;

      if (keepLastOnly || tooOld || overCap) {
        let reason = 'exceeds_keep_last';
        if (tooOld) {
          reason = 'exceeds_max_age';
        } else if (overCap) {
          reason = 'exceeds_max_total_size';
        }

        candidates.push({
          fileKey: dump.key,
          sizeBytes: dump.size,
          lastModified: dump.lastModified.toISOString(),
          category: dump.category,
          reason,
          jobId,
          isProtected: false,
        });
        toDeleteItems.push(dump);
        freedBytes += dump.size;
      } else {
        candidates.push({
          fileKey: dump.key,
          sizeBytes: dump.size,
          lastModified: dump.lastModified.toISOString(),
          category: dump.category,
          reason: 'within_retention_window',
          jobId,
          isProtected: true,
        });
      }
    });

    return {
      candidates,
      items: toDeleteItems,
      protectedCount: actualProtected,
      totalBytes: freedBytes,
    };
  }

  /**
   * Resolves which dumps to delete. Preserved for backward-compatibility.
   */
  async selectForDeletion(
    connectionSlug: string,
    category: BackupCategory,
    policy: RetentionPolicy,
  ): Promise<EnrichedR2Object[]> {
    const dryRun = await this.computeDryRun(connectionSlug, category, policy);
    return dryRun.items;
  }

  /** File keys that are the source of a RUNNING restore — must never be pruned. */
  private async getInUseFileKeys(): Promise<Set<string>> {
    const running = await this.restoreRepository.findByStatus(JobStatus.RUNNING);
    const keys = new Set<string>();
    for (const job of running) {
      if (job.r2Key) {
        keys.add(job.r2Key);
      } else if (job.sourceBackupId) {
        const backup = await this.backupRepository.findById(job.sourceBackupId);
        if (backup?.fileKey) keys.add(backup.fileKey);
      }
    }
    return keys;
  }

  private toPreview(dryRun: {
    candidates: DryRunCandidate[];
    items: EnrichedR2Object[];
    protectedCount: number;
    totalBytes: number;
  }): CleanupPreview {
    return {
      items: dryRun.items,
      count: dryRun.items.length,
      totalSizeMb: this.bytesToMb(dryRun.totalBytes),
      totalBytes: dryRun.totalBytes,
      protectedCount: dryRun.protectedCount,
      candidates: dryRun.candidates,
    };
  }

  private hasCriterion(policy: RetentionPolicy): boolean {
    return (
      policy.keepLast != null ||
      policy.maxAgeDays != null ||
      policy.maxTotalSizeMb != null
    );
  }

  private assertHasCriterion(policy: RetentionPolicy): void {
    if (!this.hasCriterion(policy)) {
      throw new BadRequestException(
        'Debe indicar al menos un criterio: "keepLast", "maxAgeDays" o "maxTotalSizeMb".',
      );
    }
  }

  private bytesToMb(bytes: number): number {
    return Number((bytes / BYTES_PER_MB).toFixed(2));
  }
}
