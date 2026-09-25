import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'crypto';

import { CreateRestoreDto } from './dto/create-restore.dto';
import { RestoreRepository } from './restore.repository';
import { RestoreLeaseRepository } from './restore-lease.repository';
import {
  RestoreExecutionOwnership,
  RestoreExecutionOwnershipService,
} from './restore-execution-ownership.service';
import { RestoreStaging, RestoreStagingService } from './restore-staging.service';
import { R2Service } from '../backup/r2.service';
import { BackupService } from '../backup/backup.service';
import { ConnectionsService } from '../connections/connections.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { sanitizeMessage } from '../../common/sanitization/sanitize-message';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { DryRunResult, DryRunSnapshot, DryRunDiff, DryRunConnectionInfo } from './interfaces/dry-run-result.interface';
import { DumpManifest } from '../backup/interfaces/dump-manifest.interface';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { SseService } from '../../shared/sse/sse.service';
import { RestoreStrategy } from '../backup/interfaces/restore-strategy.interface';
import { Client } from 'pg';
import { createConnection as createMysqlConnection, RowDataPacket } from 'mysql2/promise';

const SNAPSHOT_TIMEOUT_MS = 10_000;

@Injectable()
export class RestoreService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestoreService.name);

  constructor(
    private readonly restoreRepository: RestoreRepository,
    private readonly restoreLeaseRepository: RestoreLeaseRepository,
    private readonly restoreExecutionOwnershipService: RestoreExecutionOwnershipService,
    private readonly restoreStagingService: RestoreStagingService,
    private readonly r2Service: R2Service,
    private readonly backupService: BackupService,
    private readonly connectionsService: ConnectionsService,
    private readonly sseService: SseService,
    @Inject('RESTORE_STRATEGIES')
    private readonly restoreStrategies: Map<DbTypeEnum, RestoreStrategy>,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  private get restoreLeaseDurationMs(): number {
    const timeout =
      this.configService?.get<number>('RESTORE_TIMEOUT_MS') ?? 1_800_000;
    return timeout + 5 * 60_000;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.restoreStagingService.sweepOrphans();
    const [pendingJobs, runningJobs] = await Promise.all([
      this.restoreRepository.findByStatus(JobStatus.PENDING),
      this.restoreRepository.findByStatus(JobStatus.RUNNING),
    ]);
    const jobs = [...pendingJobs, ...runningJobs];

    if (jobs.length === 0) {
      return;
    }

    this.logger.warn(
      `Checking ${jobs.length} unfinished restore jobs on startup`,
    );

    for (const job of jobs) {
      const ownership = await this.restoreExecutionOwnershipService.tryAcquire(
        job.targetConnectionId,
      );
      if (!ownership) {
        continue;
      }

      try {
        const recovered = await this.restoreRepository.recoverIfReclaimable(
          job.id,
          job.targetConnectionId,
          'Job interrupted — process restarted',
          new Date(),
        );
        if (recovered) {
          this.logger.warn(`Marked restore job ${job.id} as failed (interrupted)`);
        }
      } finally {
        await this.restoreExecutionOwnershipService.release(ownership);
      }
    }
  }

  async createRestore(
    dto: CreateRestoreDto,
    user: AuthUser,
  ): Promise<{ jobId: string; dryRunResult?: DryRunResult }> {
    const targetConnection = await this.connectionsService.findById(
      dto.targetConnectionId,
    );

    const targetEnvironment = targetConnection.environment;

    if (targetEnvironment === Environment.PROD) {
      throw new ForbiddenException(
        `No se permiten restauraciones en producción. Conexión "${targetConnection.name}" es "prod".`,
      );
    }

    const isR2Restore = !!dto.r2Key;
    const fileKey = await this.resolveSourceFileKey(dto, targetConnection);

    if (dto.isDryRun) {
      const result = await this.dryRun(fileKey, targetConnection);

      const dryJob = await this.restoreRepository.create({
        sourceBackupId: isR2Restore ? null : dto.sourceBackupId!,
        r2Key: isR2Restore ? dto.r2Key! : null,
        targetConnectionId: targetConnection.id,
        targetEnvironment,
        status: JobStatus.COMPLETED,
        isDryRun: true,
        triggeredBy: user.id,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      this.sseService.register(dryJob.id);
      this.sseService.emit(dryJob.id, {
        type: 'completed',
        payload: { jobId: dryJob.id, completedAt: new Date() },
      });
      this.sseService.complete(dryJob.id);

      return { jobId: dryJob.id, dryRunResult: result };
    }

    const jobId = randomUUID();
    const leaseToken = randomUUID();
    const admittedJobId = await this.restoreRepository.tryCreateWithLease({
      id: jobId,
      sourceBackupId: isR2Restore ? null : dto.sourceBackupId!,
      r2Key: isR2Restore ? dto.r2Key! : null,
      targetConnectionId: targetConnection.id,
      targetEnvironment,
      triggeredBy: user.id,
      startedAt: new Date(),
      leaseToken,
      expiresAt: new Date(Date.now() + this.restoreLeaseDurationMs),
    });

    if (!admittedJobId) {
      throw new ConflictException(
        `Ya existe una restauración activa para la conexión "${targetConnection.name}".`,
      );
    }

    this.sseService.register(admittedJobId);

    setImmediate(() => {
      this.executeRestoreAsync(admittedJobId, dto, user, leaseToken);
    });

    return { jobId: admittedJobId };
  }

  async executeRestoreAsync(
    jobId: string,
    dto: CreateRestoreDto,
    _user: AuthUser,
    leaseToken: string,
  ): Promise<void> {
    const startedAt = new Date();
    let staging: RestoreStaging | null = null;
    let ownership: RestoreExecutionOwnership | null = null;
    let leaseRenewalTimer: NodeJS.Timeout | null = null;

    try {
      const started = await this.restoreRepository.startIfLeaseActive(
        jobId,
        dto.targetConnectionId,
        leaseToken,
        startedAt,
      );
      if (!started) {
        await this.restoreRepository.failPendingIfLeaseInactive(
          jobId,
          dto.targetConnectionId,
          leaseToken,
          'Restore execution became stale before it started',
          new Date(),
        );
        return;
      }

      const renewalIntervalMs = Math.min(
        60_000,
        Math.max(5_000, Math.floor(this.restoreLeaseDurationMs / 4)),
      );
      leaseRenewalTimer = setInterval(() => {
        const nextExpiresAt = new Date(Date.now() + this.restoreLeaseDurationMs);
        this.restoreLeaseRepository
          .renew(dto.targetConnectionId, jobId, leaseToken, nextExpiresAt)
          .then((renewed) => {
            if (!renewed) {
              this.logger.warn(
                `Lease renewal returned false for restore job ${jobId} — lease may have been lost`,
              );
            }
          })
          .catch((err: Error) => {
            this.logger.error(
              `Failed to renew restore lease for job ${jobId}: ${err.message}`,
            );
          });
      }, renewalIntervalMs);
      leaseRenewalTimer.unref?.();

      ownership = await this.restoreExecutionOwnershipService.tryAcquire(
        dto.targetConnectionId,
      );
      if (!ownership) {
        throw new ConflictException('Otra restauración está ejecutándose para este destino.');
      }

      this.sseService.emit(jobId, {
        type: 'progress',
        payload: { percent: 10 },
      });

      const initialTarget = await this.connectionsService.findById(
        dto.targetConnectionId,
      );
      const fileKey = await this.resolveSourceFileKey(dto, initialTarget);
      staging = await this.restoreStagingService.create(jobId, dto.targetConnectionId);
      const dumpStats = await this.restoreStagingService.writeDump(
        staging,
        await this.r2Service.download(fileKey),
      );
      await this.verifyDumpIntegrity(dto, fileKey, dumpStats.sha256);

      this.sseService.emit(jobId, {

        type: 'progress',
        payload: { percent: 25 },
      });

      const targetConnection = await this.restoreExecutionOwnershipService.findActiveTarget(
        ownership,
      );
      if (!targetConnection) {
        throw new NotFoundException('La conexión destino ya no existe o está inactiva.');
      }
      if (targetConnection.environment === Environment.PROD) {
        throw new ForbiddenException('La conexión destino fue cambiada a producción.');
      }
      if (!await this.restoreExecutionOwnershipService.hasActiveLease(
        ownership,
        jobId,
        leaseToken,
      )) {
        throw new ConflictException('El lease de restauración ya no pertenece a este trabajo.');
      }

      const liveFileKey = await this.resolveSourceFileKey(dto, targetConnection);
      if (liveFileKey !== fileKey) {
        throw new ConflictException('La fuente de restauración cambió antes de ejecutar.');
      }

      const strategy = this.restoreStrategies.get(targetConnection.dbType);
      if (!strategy) {
        throw new Error(
          `No hay estrategia de restauración configurada para tipo "${targetConnection.dbType}"`,
        );
      }

      await strategy.execute(targetConnection, staging.dumpFilePath, (message: string) => {
        this.sseService.emit(jobId, {
          type: 'log',
          payload: { message, timestamp: new Date() },
        });
      });

      this.sseService.emit(jobId, {
        type: 'progress',
        payload: { percent: 90 },
      });

      const completedAt = new Date();
      await this.restoreRepository.updateStatus(jobId, JobStatus.COMPLETED, {
        completedAt,
      });

      this.sseService.emit(jobId, {
        type: 'completed',
        payload: { jobId, completedAt },
      });
    } catch (error) {
      const completedAt = new Date();
      const rawMessage =
        error instanceof Error ? error.message : 'Error desconocido en restore';
      const errorMessage = sanitizeMessage(rawMessage);

      this.logger.error(`Restore job ${jobId} failed: ${rawMessage}`);

      await this.restoreRepository.updateStatus(jobId, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      }).catch((err: Error) => {
        this.logger.error(
          `Failed to update restore job ${jobId} status to FAILED: ${err.message}`,
        );
      });

      this.sseService.emit(jobId, {
        type: 'failed',
        payload: { jobId, error: errorMessage },
      });
    } finally {
      if (leaseRenewalTimer) {
        clearInterval(leaseRenewalTimer);
      }
      if (staging) {
        try {
          await this.restoreStagingService.cleanup(staging);
        } catch {
          this.logger.warn(`Failed to delete restore staging: ${staging.directoryPath}`);
        }
      }
      if (ownership) {
        try {
          await this.restoreExecutionOwnershipService.release(ownership);
        } catch (err) {
          this.logger.error(
            `Failed to release restore execution ownership for job ${jobId}: ${(err as Error).message}`,
          );
        }
      }
      try {
        this.sseService.complete(jobId);
      } catch (err) {
        this.logger.error(
          `Failed to complete SSE stream for job ${jobId}: ${(err as Error).message}`,
        );
      }
      try {
        await this.restoreLeaseRepository.release(
          dto.targetConnectionId,
          jobId,
          leaseToken,
        );
      } catch (err) {
        this.logger.error(
          `Failed to release restore lease for job ${jobId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async dryRun(
    fileKey: string,
    targetConnection: ConnectionEntity,
  ): Promise<DryRunResult> {
    // 1. Try to load manifest from R2
    const manifestKey = fileKey.replace(/\.dump$/, '.manifest.json');
    let source: DryRunSnapshot | null = null;
    try {
      const manifest = await this.r2Service.downloadJson<DumpManifest>(manifestKey);
      source = manifest.source;
    } catch {
      this.logger.warn(`No manifest found for ${manifestKey} — dry run will be target-only`);
    }

    // 2. Capture target snapshot
    const target = targetConnection.dbType === DbTypeEnum.MYSQL
      ? await this.captureTargetMySQL(targetConnection)
      : await this.captureTargetPostgres(targetConnection);

    // 3. Compute diff if source is available
    const diff = source ? this.computeDiff(source, target) : null;

    // 4. Resolve source connection info from fileKey slug
    let sourceConnection: DryRunConnectionInfo | undefined;
    try {
      const sourceSlug = fileKey.split('/')[0];
      if (sourceSlug) {
        const conn = await this.connectionsService.findBySlug(sourceSlug);
        sourceConnection = {
          name: conn.name,
          database: conn.database,
          environment: conn.environment,
          dbType: conn.dbType,
        };
      }
    } catch {
      // Source connection may have been deleted — not critical
    }

    const targetConnectionInfo: DryRunConnectionInfo = {
      name: targetConnection.name,
      database: targetConnection.database,
      environment: targetConnection.environment,
      dbType: targetConnection.dbType,
    };

    return {
      source,
      target,
      diff,
      manifestAvailable: source !== null,
      sourceConnection,
      targetConnection: targetConnectionInfo,
    };
  }

  private async resolveSourceFileKey(
    dto: CreateRestoreDto,
    targetConnection: ConnectionEntity,
  ): Promise<string> {
    if (dto.r2Key) {
      await this.assertR2KeyMatchesTarget(dto.r2Key, targetConnection);
      return dto.r2Key;
    }

    const backup = await this.backupService.getBackupById(dto.sourceBackupId!);
    if (backup.status !== JobStatus.COMPLETED || !backup.fileKey) {
      throw new ForbiddenException('El backup fuente no está completado o no tiene archivo.');
    }
    if (backup.dbType !== targetConnection.dbType) {
      throw new ForbiddenException(
        `Tipo de base de datos incompatible: el backup es "${backup.dbType}" ` +
          `pero el destino "${targetConnection.name}" es "${targetConnection.dbType}".`,
      );
    }

    return backup.fileKey;
  }

  private async captureTargetPostgres(
    connection: ConnectionEntity,
  ): Promise<DryRunSnapshot> {
    const client = new Client({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectionTimeoutMillis: SNAPSHOT_TIMEOUT_MS,
    });

    try {
      await client.connect();
      const result = await client.query<{ name: string; estimated_rows: string }>(`
        SELECT schemaname || '.' || relname AS name,
               COALESCE(n_live_tup, 0) AS estimated_rows
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
      `);
      return this.toSnapshot(result.rows);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async captureTargetMySQL(
    connection: ConnectionEntity,
  ): Promise<DryRunSnapshot> {
    const conn = await createMysqlConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectTimeout: SNAPSHOT_TIMEOUT_MS,
    });

    try {
      const [rows] = await conn.query<(RowDataPacket & { name: string; estimated_rows: string })[]>(`
        SELECT TABLE_NAME AS name, COALESCE(TABLE_ROWS, 0) AS estimated_rows
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_ROWS DESC
      `);
      return this.toSnapshot(rows);
    } finally {
      await conn.end();
    }
  }

  private toSnapshot(
    rows: Array<{ name: string; estimated_rows: string }>,
  ): DryRunSnapshot {
    const tables = rows.map((row) => ({
      name: row.name,
      estimatedRows: Number(row.estimated_rows),
    }));
    return {
      tableCount: tables.length,
      estimatedRows: tables.reduce((sum, t) => sum + t.estimatedRows, 0),
      tables,
    };
  }

  private computeDiff(
    source: DryRunSnapshot,
    target: DryRunSnapshot,
  ): DryRunDiff {
    const sourceMap = new Map(source.tables.map((t) => [t.name, t.estimatedRows]));
    const targetMap = new Map(target.tables.map((t) => [t.name, t.estimatedRows]));

    const added = source.tables
      .filter((t) => !targetMap.has(t.name))
      .map((t) => t.name);

    const removed = target.tables
      .filter((t) => !sourceMap.has(t.name))
      .map((t) => t.name);

    const common = source.tables
      .filter((t) => targetMap.has(t.name))
      .map((t) => ({
        name: t.name,
        sourceRows: t.estimatedRows,
        targetRows: targetMap.get(t.name)!,
      }));

    return { added, removed, common };
  }

  /**
   * Guarantees the requested r2Key is a well-formed dump path belonging to a
   * known source connection whose dbType matches the target. Without this
   * gate, an authenticated user could submit any string as `r2Key` and trigger
   * a destructive restore (TRUNCATE / --clean) against an unrelated target.
   */
  private async assertR2KeyMatchesTarget(
    r2Key: string,
    targetConnection: ConnectionEntity,
  ): Promise<void> {
    const segments = r2Key.split('/');
    const looksLikeDumpPath =
      segments.length === 3 &&
      segments[0].length > 0 &&
      segments[1].length > 0 &&
      segments[2].endsWith('.dump') &&
      !segments.some((s) => s === '..' || s === '.' || s.includes('\\'));

    if (!looksLikeDumpPath) {
      throw new ForbiddenException(
        `Clave R2 inválida. Se esperaba el formato "{slug}/{categoría}/{timestamp}.dump".`,
      );
    }

    const [sourceSlug, category] = segments;

    const validCategories = Object.values(BackupCategory) as string[];
    if (!validCategories.includes(category)) {
      throw new ForbiddenException(
        `Categoría de backup "${category}" no reconocida en la clave R2.`,
      );
    }

    let sourceConnection: ConnectionEntity;
    try {
      sourceConnection = await this.connectionsService.findBySlug(sourceSlug);
    } catch {
      throw new ForbiddenException(
        `El dump seleccionado no pertenece a ninguna conexión registrada.`,
      );
    }

    if (sourceConnection.dbType !== targetConnection.dbType) {
      throw new ForbiddenException(
        `Tipo de base de datos incompatible: el dump es "${sourceConnection.dbType}" ` +
          `pero el destino "${targetConnection.name}" es "${targetConnection.dbType}".`,
      );
    }
  }

  private async verifyDumpIntegrity(
    dto: CreateRestoreDto,
    fileKey: string,
    actualSha256: string,
  ): Promise<void> {
    let expectedSha256: string | null = null;

    if (dto.sourceBackupId) {
      try {
        const backup = await this.backupService.getBackupById(dto.sourceBackupId);
        if (backup?.sha256) {
          expectedSha256 = backup.sha256;
        }
      } catch {
        expectedSha256 = null;
      }
    }


    if (!expectedSha256) {
      const manifestKey = fileKey.replace(/\.dump$/, '.manifest.json');
      const manifest = await this.r2Service
        .downloadJson<DumpManifest>(manifestKey)
        .catch(() => null);

      if (manifest && 'sha256' in manifest && manifest.sha256) {
        expectedSha256 = manifest.sha256;
      }
    }

    if (expectedSha256) {
      const isValid = this.isDigestEqual(expectedSha256, actualSha256);
      if (!isValid) {
        throw new BadRequestException(
          'El dump descargado no coincide con el digest criptográfico registrado (SHA-256). Posible corrupción o manipulación del archivo.',
        );
      }
    }
  }

  private isDigestEqual(expected: string, actual: string): boolean {
    if (typeof expected !== 'string' || typeof actual !== 'string') {
      return false;
    }
    const cleanExpected = expected.trim().toLowerCase();
    const cleanActual = actual.trim().toLowerCase();
    if (cleanExpected.length !== 64 || cleanActual.length !== 64) {
      return false;
    }
    const bufExpected = Buffer.from(cleanExpected, 'hex');
    const bufActual = Buffer.from(cleanActual, 'hex');
    if (bufExpected.length !== 32 || bufActual.length !== 32) {
      return false;
    }
    return timingSafeEqual(bufExpected, bufActual);
  }

  async listRestores() {
    return this.restoreRepository.findAll();
  }

  async getRestoreById(id: string) {
    const job = await this.restoreRepository.findById(id);
    if (!job) {
      throw new NotFoundException(
        `Restore job con ID "${id}" no encontrado`,
      );
    }
    return job;
  }
}
