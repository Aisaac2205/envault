import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID, timingSafeEqual } from 'crypto';

import { CreateRestoreDto } from './dto/create-restore.dto';
import { RestoreRepository } from './restore.repository';
import { RestoreLeaseRepository } from './restore-lease.repository';
import {
  RestoreExecutionOwnership,
  RestoreExecutionOwnershipService,
} from './restore-execution-ownership.service';
import { RestoreStaging, RestoreStagingService } from './restore-staging.service';
import { RESTORE_QUEUE_NAME } from './restore.constants';
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
import {
  RestoreIncompatibleError,
  RestoreStrategy,
} from '../backup/interfaces/restore-strategy.interface';
import { RestoreRollbackError } from '../backup/strategies/mysql-schema-objects';
import { Client } from 'pg';
import { createConnection as createMysqlConnection, RowDataPacket } from 'mysql2/promise';

const SNAPSHOT_TIMEOUT_MS = 10_000;
const DEFAULT_RESTORE_TIMEOUT_MS = 1_800_000;
const CANCELLED_MESSAGE = 'Operación cancelada por el usuario';

/** Why the signal of a restore fired; the message of the job is chosen from it. */
type RestoreAbortReason = { kind: 'cancelled' } | { kind: 'timeout'; timeoutMs: number };

/** 1800000 -> "30 min", 90000 -> "1.5 min", 10000 -> "10 s". */
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

function deadlineMessage(timeoutMs: number): string {
  return `Restore exceeded the time limit of ${formatDuration(timeoutMs)} (RESTORE_TIMEOUT_MS)`;
}

@Injectable()
export class RestoreService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RestoreService.name);
  private readonly activeRestores = new Map<
    string,
    { controller: AbortController; abort: (reason: RestoreAbortReason) => void }
  >();

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
    @InjectQueue(RESTORE_QUEUE_NAME)
    private readonly restoreQueue?: Queue,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  /** Limit for the whole restore, from the moment it starts running. */
  private get restoreTimeoutMs(): number {
    return this.configService?.get<number>('RESTORE_TIMEOUT_MS') ?? DEFAULT_RESTORE_TIMEOUT_MS;
  }

  private get restoreLeaseDurationMs(): number {
    return this.restoreTimeoutMs + 5 * 60_000;
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

    await this.assertRestoreCompatible(fileKey, targetConnection);

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

    if (this.restoreQueue) {
      try {
        await this.restoreQueue.add(
          'process-restore',
          {
            jobId: admittedJobId,
            dto,
            user,
            leaseToken,
          },
          {
            jobId: admittedJobId,
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
      } catch (queueErr) {
        const errorMessage =
          queueErr instanceof Error ? queueErr.message : 'Error desconocido al encolar en Redis';
        this.logger.error(`Failed to enqueue restore job ${admittedJobId}: ${errorMessage}`);
        await this.restoreLeaseRepository.releaseByJobId(admittedJobId).catch(() => {});
        await this.restoreRepository.updateStatus(admittedJobId, JobStatus.FAILED, {
          errorMessage: `Fallo al encolar en Redis: ${errorMessage}`,
          completedAt: new Date(),
        });
        this.sseService.emit(admittedJobId, {
          type: 'failed',
          payload: { jobId: admittedJobId, error: `Fallo al encolar en Redis: ${errorMessage}` },
        });
        this.sseService.complete(admittedJobId);
        throw new InternalServerErrorException(
          `No se pudo encolar el trabajo de restauración en Redis: ${errorMessage}`,
        );
      }
    } else {
      setImmediate(() => {
        this.executeRestoreAsync(admittedJobId, dto, user, leaseToken);
      });
    }

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
    let deadlineTimer: NodeJS.Timeout | null = null;
    const abortController = new AbortController();
    // Why the signal fired. The message of the job comes from this, never from
    // the error that reached the catch: every step rejects an aborted signal in
    // its own words (the CLIs say "cancelled by user" even for a timeout, the
    // S3 client says "Request aborted").
    const abortState: { reason: RestoreAbortReason | null } = { reason: null };
    const abort = (reason: RestoreAbortReason): void => {
      if (abortController.signal.aborted) return;
      abortState.reason = reason;
      abortController.abort();
    };
    this.activeRestores.set(jobId, { controller: abortController, abort });
    const signal = abortController.signal;

    try {
      if (signal.aborted) {
        throw new Error(CANCELLED_MESSAGE);
      }

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

      // The whole restore gets one limit, counted from here and not from when
      // it was admitted: time spent waiting for its turn is not the restore's.
      const timeoutMs = this.restoreTimeoutMs;
      deadlineTimer = setTimeout(() => abort({ kind: 'timeout', timeoutMs }), timeoutMs);
      deadlineTimer.unref?.();

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
                `Lease renewal returned false for restore job ${jobId}. Lease may have been lost`,
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

      if (signal.aborted) {
        throw new Error(CANCELLED_MESSAGE);
      }

      let expectedBytes: number | null = null;
      if (dto.sourceBackupId) {
        try {
          const backup = await this.backupService.getBackupById(dto.sourceBackupId);
          if (backup?.bytes) {
            expectedBytes = Number(backup.bytes);
          } else if (backup?.fileSizeMb) {
            expectedBytes = Math.ceil(backup.fileSizeMb * 1024 * 1024);
          }
        } catch {
          expectedBytes = null;
        }
      }

      if (!expectedBytes && typeof this.r2Service.getObjectSize === 'function') {
        expectedBytes = (await this.r2Service.getObjectSize(fileKey, { abortSignal: signal })) ?? null;
      }

      if (typeof this.restoreStagingService.checkAvailableDiskSpace === 'function') {
        await this.restoreStagingService.checkAvailableDiskSpace(
          expectedBytes ?? 50 * 1024 * 1024,
        );
      }

      this.sseService.emit(jobId, {
        type: 'log',
        payload: {
          message: 'Verificación de espacio en disco de staging completada exitosamente.',
          timestamp: new Date(),
        },
      });

      staging = await this.restoreStagingService.create(jobId, dto.targetConnectionId);
      const dumpStats = await this.restoreStagingService.writeDump(
        staging,
        await this.r2Service.download(fileKey, { abortSignal: signal }),
        { signal },
      );
      await this.verifyDumpIntegrity(dto, fileKey, dumpStats.sha256, signal);

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

      if (signal.aborted) {
        throw new Error(CANCELLED_MESSAGE);
      }

      await strategy.execute(
        targetConnection,
        staging.dumpFilePath,
        (message: string) => {
          this.sseService.emit(jobId, {
            type: 'log',
            payload: { message, timestamp: new Date() },
          });
        },
        { abortSignal: signal },
      );

      // A strategy may refuse to stop once it is past the point of no return (the
      // MySQL swap finishes or rolls back, it is never cut in half). If it
      // finished, the target changed: this is a completed restore, however late.
      if (abortState.reason) {
        this.logger.warn(
          `Restore job ${jobId} finished after it was asked to stop (${abortState.reason.kind})`,
        );
        this.sseService.emit(jobId, {
          type: 'log',
          payload: {
            message:
              abortState.reason.kind === 'timeout'
                ? `The restore went past the time limit of ${formatDuration(abortState.reason.timeoutMs)} while its last step was running. That step cannot be interrupted, it finished and the target was restored.`
                : 'The restore was cancelled while its last step was running. That step cannot be interrupted, it finished and the target was restored.',
            timestamp: new Date(),
          },
        });
      }

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
      const rawMessage = this.failureMessage(error, abortState.reason);
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
      this.activeRestores.delete(jobId);
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
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

  /**
   * The message a failed restore is stored and reported with. An abort says why
   * it happened (a deadline, a cancel) whatever the step it interrupted threw.
   * The exception is a failed rollback: its message tells where the original
   * data is, and the person who has to recover it needs that more than the cause.
   */
  private failureMessage(error: unknown, reason: RestoreAbortReason | null): string {
    if (error instanceof RestoreRollbackError) {
      return error.message;
    }
    if (reason?.kind === 'timeout') {
      return deadlineMessage(reason.timeoutMs);
    }
    if (reason?.kind === 'cancelled') {
      return CANCELLED_MESSAGE;
    }
    return error instanceof Error ? error.message : 'Error desconocido en restore';
  }

  private async dryRun(
    fileKey: string,
    targetConnection: ConnectionEntity,
  ): Promise<DryRunResult> {
    // 1. Try to load manifest from R2
    const source: DryRunSnapshot | null =
      (await this.loadManifest(fileKey))?.source ?? null;
    if (!source) {
      this.logger.warn(
        `No manifest found for ${fileKey.replace(/\.dump$/, '.manifest.json')} — dry run will be target-only`,
      );
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

  private async loadManifest(fileKey: string): Promise<DumpManifest | null> {
    try {
      return await this.r2Service.downloadJson<DumpManifest>(
        fileKey.replace(/\.dump$/, '.manifest.json'),
      );
    } catch {
      return null;
    }
  }

  /**
   * Refuses a restore that can never work (for example loading a PostgreSQL 17
   * backup into a PostgreSQL 16 server) with a 422 and the reason, before a job,
   * a lease or a queue entry exists. The check is best effort: anything it
   * cannot establish here is verified again by the strategy when the job runs,
   * and always before the target is touched.
   */
  private async assertRestoreCompatible(
    fileKey: string,
    targetConnection: ConnectionEntity,
  ): Promise<void> {
    const strategy = this.restoreStrategies.get(targetConnection.dbType);
    if (!strategy?.assertCompatible) {
      return;
    }

    const manifest = await this.loadManifest(fileKey);
    try {
      await strategy.assertCompatible(targetConnection, {
        serverVersion: manifest?.source?.serverVersion,
      });
    } catch (error) {
      if (error instanceof RestoreIncompatibleError) {
        throw new UnprocessableEntityException(error.message);
      }
      this.logger.warn(
        `Request-time compatibility check skipped: ${sanitizeMessage(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private async resolveSourceFileKey(
    dto: CreateRestoreDto,
    targetConnection: ConnectionEntity,
  ): Promise<string> {
    if (dto.r2Key) {
      await this.assertR2KeyMatchesTarget(dto.r2Key, targetConnection);
      return dto.r2Key;
    }

    // Defense in depth behind CreateRestoreDto: a lookup by an undefined id
    // would be a query without a where clause and resolve an arbitrary backup.
    if (!dto.sourceBackupId) {
      throw new BadRequestException(
        'Debe indicar sourceBackupId o r2Key como origen de la restauración.',
      );
    }

    const backup = await this.backupService.getBackupById(dto.sourceBackupId);
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
    // A socket reset after the connection is up is emitted as 'error'; without a
    // listener it is an uncaughtException that the fatal runtime policy turns
    // into a process exit. The query reports its own failures.
    client.on('error', (error: Error) => {
      this.logger.warn(
        `Dry-run target connection error: ${sanitizeMessage(error.message)}`,
      );
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
    // Same as the PostgreSQL probe: an error on the idle connection must not
    // reach the process as an uncaughtException.
    conn.on('error', (error: Error) => {
      this.logger.warn(
        `Dry-run target connection error: ${sanitizeMessage(error.message)}`,
      );
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
    signal: AbortSignal,
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
      // A missing manifest only means there is nothing to compare with. A
      // deadline or a cancel is not that: it must stop the restore, not skip the check.
      const manifest = await this.r2Service
        .downloadJson<DumpManifest>(manifestKey, { abortSignal: signal })
        .catch((error: unknown) => {
          if (signal.aborted) throw error;
          return null;
        });

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

  async cancelRestore(
    id: string,
    _user: AuthUser,
  ): Promise<{ message: string; jobId: string; status: JobStatus }> {
    const job = await this.restoreRepository.findById(id);
    if (!job) {
      throw new NotFoundException(`Restore job con ID "${id}" no encontrado`);
    }

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      throw new ConflictException(
        `No se puede cancelar un trabajo de restauración con estado "${job.status}".`,
      );
    }

    const completedAt = new Date();
    const errorMessage = CANCELLED_MESSAGE;

    if (job.status === JobStatus.PENDING) {
      if (this.restoreQueue) {
        try {
          const bullJob = await this.restoreQueue.getJob(job.id);
          if (bullJob) {
            await bullJob.remove();
          }
        } catch (queueErr) {
          this.logger.warn(`Could not remove pending restore job ${job.id} from BullMQ: ${queueErr}`);
        }
      }

      await this.restoreLeaseRepository.releaseByJobId(job.id).catch((err: Error) => {
        this.logger.error(`Failed to release lease on cancel for job ${job.id}: ${err.message}`);
      });

      await this.restoreRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      });

      this.sseService.emit(job.id, {
        type: 'log',
        payload: {
          message: errorMessage,
          timestamp: completedAt,
        },
      });
      this.sseService.emit(job.id, {
        type: 'failed',
        payload: { jobId: job.id, error: errorMessage },
      });
      this.sseService.complete(job.id);

      return {
        message: 'Restauración cancelada exitosamente',
        jobId: job.id,
        status: JobStatus.FAILED,
      };
    }

    const active = this.activeRestores.get(job.id);
    if (active) {
      active.abort({ kind: 'cancelled' });
    } else {
      await this.restoreLeaseRepository.releaseByJobId(job.id).catch(() => {});
      await this.restoreRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      });
      this.sseService.emit(job.id, {
        type: 'failed',
        payload: { jobId: job.id, error: errorMessage },
      });
      this.sseService.complete(job.id);
    }

    return {
      message: 'Restauración cancelada exitosamente',
      jobId: job.id,
      status: JobStatus.FAILED,
    };
  }
}
