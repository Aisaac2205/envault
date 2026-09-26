import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, UnrecoverableError } from 'bullmq';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { createConnection as createMysqlConnection, RowDataPacket } from 'mysql2/promise';
import { sanitizeMessage } from '../../common/sanitization/sanitize-message';
import { CreateBackupDto } from './dto/create-backup.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { BackupRepository } from './backup.repository';
import { BackupLeaseRepository } from './backup-lease.repository';
import { R2Service } from './r2.service';
import {
  BACKUP_LEASE_HEARTBEAT_MS,
  BACKUP_LEASE_RENEWAL_DEADLINE_MS,
  BACKUP_LEASE_TTL_MS,
  BACKUP_QUEUE_NAME,
} from './backup.constants';
import { SseService } from '../../shared/sse/sse.service';
import { BackupResult } from './interfaces/backup-result.interface';
import { BackupHistoryItem } from './interfaces/backup-history-item.interface';
import { R2Object } from './interfaces/r2-object.interface';
import { EnrichedR2Object } from './interfaces/enriched-r2-object.interface';
import { BackupStrategy } from './interfaces/backup-strategy.interface';
import {
  BackupAbortReason,
  QueuedBackupOutcome,
} from './interfaces/queued-backup-outcome.interface';
import { DumpManifest, DumpManifestSource } from './interfaces/dump-manifest.interface';
import { ConnectionsService } from '../connections/connections.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import {
  BackupJobEntity,
  STORAGE_KEY_VERSION,
} from '../../database/entities/backup-job.entity';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';

@Injectable()
export class BackupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BackupService.name);
  private readonly activeBackups = new Map<
    string,
    { controller: AbortController; abort: (reason: BackupAbortReason) => void }
  >();
  private readonly backupTimeoutMs: number;

  constructor(
    private readonly backupRepository: BackupRepository,
    private readonly backupLeaseRepository: BackupLeaseRepository,
    private readonly r2Service: R2Service,
    private readonly connectionsService: ConnectionsService,
    private readonly sseService: SseService,
    @InjectQueue(BACKUP_QUEUE_NAME)
    private readonly backupQueue: Queue,
    @Inject('BACKUP_STRATEGIES')
    private readonly backupStrategies: Map<DbTypeEnum, BackupStrategy>,
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    this.backupTimeoutMs =
      this.configService?.get<number>('BACKUP_TIMEOUT_MS') ?? 1_800_000;
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.sweepOrphans();
  }

  async sweepOrphans(): Promise<void> {
    try {
      const unfinished = await this.backupRepository.findAllUnfinished();
      if (unfinished.length === 0) {
        return;
      }

      this.logger.warn(
        `Detectados ${unfinished.length} respaldos sin finalizar al iniciar el proceso. Revisando huérfanos...`,
      );

      for (const job of unfinished) {
        try {
          const failed =
            job.status === JobStatus.PENDING
              ? await this.sweepPendingJob(job.id)
              : await this.backupRepository.failRunningWithoutLease(
                  job.id,
                  'Respaldo interrumpido por reinicio o detención del servicio',
                  new Date(),
                );

          if (failed) {
            this.logger.warn(
              `Respaldo huérfano ${job.id} (conexión ${job.connectionId}) marcado como FAILED`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Error revisando respaldo huérfano ${job.id}: ${message}`,
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error en sweepOrphans de BackupService: ${message}`);
    }
  }

  /**
   * A PENDING row whose BullMQ job still exists (waiting, delayed, etc.) is
   * left alone — it will be processed normally. Only a row whose BullMQ job
   * is gone (`unknown`, `completed`, `failed`) is a candidate for failure,
   * and even then only past the 60s grace period that protects an in-flight
   * `createBackup` insert.
   */
  private async sweepPendingJob(jobId: string): Promise<boolean> {
    const state = await this.backupQueue.getJobState(jobId);
    if (state !== 'unknown' && state !== 'completed' && state !== 'failed') {
      return false;
    }

    return this.backupRepository.failPendingStale(
      jobId,
      'Respaldo interrumpido por reinicio o detención del servicio',
      new Date(),
    );
  }

  async createBackup(
    dto: CreateBackupDto,
    user: AuthUser,
    category: BackupCategory = BackupCategory.MANUAL,
  ): Promise<BackupResult> {
    const connection = await this.connectionsService.findById(dto.connectionId);

    if (connection.environment !== Environment.PROD) {
      throw new BadRequestException(
        `Solo se permiten backups del entorno de producción. Conexión "${connection.name}" es "${connection.environment}".`,
      );
    }

    const strategy = this.backupStrategies.get(connection.dbType);
    if (!strategy) {
      throw new BadRequestException(
        `No hay estrategia de backup configurada para tipo "${connection.dbType}"`,
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    const fileKey = `${connection.slug}/${category}/${timestamp}-${uniqueSuffix}.dump`;

    const { job, created } = await this.backupRepository.insertPendingOrFindExisting({
      connectionId: connection.id,
      environment: connection.environment,
      dbType: connection.dbType,
      fileKey,
      triggeredBy: user.id,
      category,
      storageKeyVersion: STORAGE_KEY_VERSION.NEW,
    });

    if (!created) {
      this.logger.log(
        `Ya existe un respaldo en cola para la conexión "${connection.name}" y categoría "${category}" (Job: ${job.id}). Reutilizando ticket de cola.`,
      );
      return {
        jobId: job.id,
        fileKey: job.fileKey ?? '',
        status: JobStatus.PENDING,
      };
    }

    this.sseService.register(job.id);
    this.sseService.emit(job.id, {
      type: 'log',
      payload: {
        message: `Respaldo registrado en cola (${category}) para "${connection.name}".`,
        timestamp: new Date(),
      },
    });
    this.sseService.emit(job.id, {
      type: 'progress',
      payload: { percent: 0 },
    });

    try {
      await this.backupQueue.add(
        'process-backup',
        { jobId: job.id },
        {
          jobId: job.id,
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    } catch (queueErr) {
      const errorMessage =
        queueErr instanceof Error ? queueErr.message : 'Error desconocido al encolar en Redis';
      this.logger.error(`Failed to enqueue backup job ${job.id}: ${errorMessage}`);
      await this.backupRepository.markFailedIfUnfinished(
        job.id,
        `Fallo al encolar en Redis: ${errorMessage}`,
        new Date(),
      );
      this.sseService.emit(job.id, {
        type: 'failed',
        payload: { jobId: job.id, error: `Fallo al encolar en Redis: ${errorMessage}` },
      });
      this.sseService.complete(job.id);
      throw new InternalServerErrorException(
        `No se pudo encolar el trabajo de backup en Redis: ${errorMessage}`,
      );
    }

    return {
      jobId: job.id,
      fileKey,
      status: JobStatus.PENDING,
    };
  }

  async executeQueuedBackup(
    jobId: string,
    options: { isRetry: boolean } = { isRetry: false },
  ): Promise<QueuedBackupOutcome> {
    const job = await this.backupRepository.findById(jobId);
    if (!job) {
      this.logger.error(`Backup job ${jobId} not found in database`);
      throw new UnrecoverableError(`Backup job "${jobId}" no encontrado`);
    }

    if (job.status === JobStatus.COMPLETED) {
      this.logger.warn(`Backup job ${jobId} ya estaba completado.`);
      return {
        kind: 'finished',
        result: {
          jobId: job.id,
          fileKey: job.fileKey!,
          fileSizeMb: job.fileSizeMb ?? undefined,
          sha256: job.sha256 ?? undefined,
          bytes: job.bytes ?? undefined,
          status: JobStatus.COMPLETED,
        },
      };
    }

    if (job.status === JobStatus.FAILED && !options.isRetry) {
      this.logger.warn(
        `Backup job ${jobId} ya está en un estado terminal (${job.status}); se omite la reejecución.`,
      );
      return { kind: 'skipped', status: job.status };
    }

    const connection = await this.connectionsService.findById(job.connectionId);
    if (connection.environment !== Environment.PROD) {
      throw new UnrecoverableError(
        `Solo se permiten backups del entorno de producción. Conexión "${connection.name}" es "${connection.environment}".`,
      );
    }
    const strategy = this.backupStrategies.get(connection.dbType);
    if (!strategy) {
      throw new UnrecoverableError(
        `No hay estrategia de backup configurada para tipo "${connection.dbType}"`,
      );
    }

    const leaseToken = randomUUID();
    const leaseAcquired = await this.backupLeaseRepository.tryAcquire(
      connection.id,
      job.id,
      leaseToken,
      BACKUP_LEASE_TTL_MS,
    );
    if (!leaseAcquired) {
      this.logger.log(
        `Conexión "${connection.name}" ya tiene un respaldo en curso. Difiriendo job ${job.id}.`,
      );
      return { kind: 'deferred' };
    }

    const abortController = new AbortController();
    const abortState: { reason: BackupAbortReason | null } = { reason: null };
    const abort = (reason: BackupAbortReason): void => {
      if (abortController.signal.aborted) return;
      abortState.reason = reason;
      abortController.abort();
    };
    this.activeBackups.set(job.id, { controller: abortController, abort });

    let heartbeatTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    try {
      if (abortController.signal.aborted) {
        throw new Error('Operación cancelada por el usuario');
      }

      const startedAt = new Date();
      const started = await this.backupRepository.startIfRunnable(
        job.id,
        startedAt,
        options.isRetry,
      );
      if (!started) {
        return { kind: 'skipped', status: job.status };
      }

      let lastConfirmedAt = Date.now();
      heartbeatTimer = setInterval(() => {
        this.backupLeaseRepository
          .renew(connection.id, job.id, leaseToken, BACKUP_LEASE_TTL_MS)
          .then((renewed) => {
            if (renewed) {
              lastConfirmedAt = Date.now();
              return;
            }
            this.logger.warn(
              `Lease renewal returned false for backup job ${job.id}. Lease may have been lost`,
            );
            abort({ kind: 'lease-lost', cause: 'revoked' });
          })
          .catch((err: Error) => {
            this.logger.error(
              `Failed to renew backup lease for job ${job.id}: ${err.message}`,
            );
            if (Date.now() - lastConfirmedAt >= BACKUP_LEASE_RENEWAL_DEADLINE_MS) {
              abort({ kind: 'lease-lost', cause: 'renewal-deadline' });
            }
          });
      }, BACKUP_LEASE_HEARTBEAT_MS);
      heartbeatTimer.unref?.();

      timeoutTimer = setTimeout(() => {
        abort({ kind: 'timeout', timeoutMs: this.backupTimeoutMs });
      }, this.backupTimeoutMs);
      timeoutTimer.unref?.();

      this.sseService.register(job.id);
      this.sseService.emit(job.id, {
        type: 'log',
        payload: {
          message: `Iniciando volcado para conexión "${connection.name}" (${connection.dbType})...`,
          timestamp: startedAt,
        },
      });
      this.sseService.emit(job.id, {
        type: 'progress',
        payload: { percent: 15 },
      });

      const metadata: Record<string, string> = {
        connectionId: connection.id,
        connectionSlug: connection.slug,
        category: job.category ?? BackupCategory.MANUAL,
        environment: connection.environment,
        dbType: connection.dbType,
        triggeredBy: job.triggeredBy,
      };

      const sourceSnapshot = await this.captureSourceSnapshot(connection);

      this.sseService.emit(job.id, {
        type: 'log',
        payload: {
          message: `Snapshot de origen capturado (${sourceSnapshot.tableCount} tablas, ~${sourceSnapshot.estimatedRows} filas).`,
          timestamp: new Date(),
        },
      });
      this.sseService.emit(job.id, {
        type: 'progress',
        payload: { percent: 35 },
      });

      this.sseService.emit(job.id, {
        type: 'log',
        payload: {
          message: 'Ejecutando streaming de dump hacia Cloudflare R2...',
          timestamp: new Date(),
        },
      });
      this.sseService.emit(job.id, {
        type: 'progress',
        payload: { percent: 50 },
      });

      const backupResult = await strategy.execute(connection, job.fileKey!, metadata, {
        abortSignal: abortController.signal,
      });

      const manifest: DumpManifest = {
        version: 2,
        createdAt: startedAt.toISOString(),
        dbType: connection.dbType,
        database: connection.database,
        source: sourceSnapshot,
        sha256: backupResult.sha256,
        bytes: backupResult.bytes,
        compression: 'none',
      };
      const manifestKey = job.fileKey!.replace(/\.dump$/, '.manifest.json');
      try {
        await this.r2Service.upload(
          manifestKey,
          Readable.from(JSON.stringify(manifest)),
          { abortSignal: abortController.signal },
        );
      } catch (manifestError) {
        await this.r2Service.delete(job.fileKey!).catch(() => {});
        throw manifestError;
      }

      const completedAt = new Date();

      const completed = await this.backupRepository.completeIfLeaseHeld(
        job.id,
        connection.id,
        leaseToken,
        {
          fileSizeMb: backupResult.fileSizeMb,
          sha256: backupResult.sha256,
          bytes: backupResult.bytes,
          completedAt,
        },
      );

      if (!completed) {
        this.logger.warn(
          `Backup job ${job.id} finished but no longer holds the connection lease; leaving the outcome to the current owner. Dump object left in R2 for reconcile.`,
        );
        const current = await this.backupRepository.findById(job.id);
        return { kind: 'skipped', status: current?.status ?? JobStatus.RUNNING };
      }

      this.sseService.emit(job.id, {
        type: 'log',
        payload: {
          message: `Respaldo completado exitosamente: ${backupResult.fileSizeMb.toFixed(2)} MB, SHA-256 verificado.`,
          timestamp: completedAt,
        },
      });
      this.sseService.emit(job.id, {
        type: 'progress',
        payload: { percent: 100 },
      });
      this.sseService.emit(job.id, {
        type: 'completed',
        payload: { jobId: job.id, completedAt },
      });
      this.sseService.complete(job.id);

      return {
        kind: 'finished',
        result: {
          jobId: job.id,
          fileKey: job.fileKey!,
          fileSizeMb: backupResult.fileSizeMb,
          sha256: backupResult.sha256,
          bytes: backupResult.bytes,
          startedAt,
          completedAt,
          status: JobStatus.COMPLETED,
        },
      };
    } catch (error) {
      const completedAt = new Date();
      const rawMessage =
        error instanceof Error ? error.message : 'Error desconocido en backup';
      const errorMessage = sanitizeMessage(rawMessage);

      this.logger.error(`Backup failed for connection ${connection.id}: ${errorMessage}`);

      const owned = await this.backupRepository.failIfLeaseHeld(
        job.id,
        connection.id,
        leaseToken,
        errorMessage,
        completedAt,
      );

      if (!owned) {
        this.logger.warn(
          `Backup job ${job.id} lost the connection lease before it could record failure; leaving the outcome to the current owner.`,
        );
        throw new Error(
          `Backup job ${job.id} was fenced out by another lease owner: ${errorMessage}`,
        );
      }

      await this.r2Service.delete(job.fileKey!).catch(() => {});

      this.sseService.emit(job.id, {
        type: 'failed',
        payload: { jobId: job.id, error: errorMessage },
      });
      this.sseService.complete(job.id);

      // Classify strictly by the closure-held `abortState.reason`, never by
      // `rawMessage`: every strategy rejects an aborted signal with the same
      // hardcoded "Operación cancelada por el usuario" message regardless of
      // WHY the signal fired (cancel, timeout, or a lost lease), so matching
      // on the message would misclassify a timeout or lease-lost dump as a
      // user cancel and swallow a retry it should get.
      if (abortState.reason?.kind === 'cancelled') {
        return {
          kind: 'finished',
          result: {
            jobId: job.id,
            fileKey: job.fileKey!,
            status: JobStatus.FAILED,
          },
        };
      }

      if (abortState.reason?.kind === 'timeout') {
        throw new UnrecoverableError(
          `Backup job ${job.id} excedió el tiempo límite de ejecución (${abortState.reason.timeoutMs}ms)`,
        );
      }

      throw new InternalServerErrorException(
        `Backup failed for job ${job.id}: ${errorMessage}`,
      );
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      this.activeBackups.delete(job.id);
      await this.backupLeaseRepository
        .release(connection.id, job.id, leaseToken)
        .catch((err: Error) => {
          this.logger.error(
            `Failed to release backup lease for job ${job.id}: ${err.message}`,
          );
        });
    }
  }

  async listBackups(): Promise<BackupJobEntity[]> {
    const { data } = await this.backupRepository.findAll();
    return data;
  }

  async getHistory(
    query?: ListHistoryQueryDto,
  ): Promise<PaginatedResponseDto<BackupHistoryItem>> {
    const { data: jobs, total } = await this.backupRepository.findAll({
      page: query?.page,
      pageSize: query?.pageSize,
      connectionId: query?.connectionId,
      environment: query?.environment,
      status: query?.status,
      from: query?.from,
      to: query?.to,
    });

    if (jobs.length === 0) {
      return new PaginatedResponseDto<BackupHistoryItem>(
        [],
        total,
        query?.page ?? 1,
        query?.pageSize ?? 25,
      );
    }

    const ids = [...new Set(jobs.map((j) => j.connectionId))];
    const nameMap = await this.connectionsService.findByIds(ids);

    const items: BackupHistoryItem[] = jobs.map((job) => ({
      ...job,
      connectionName: nameMap.get(job.connectionId) ?? '(eliminada)',
    }));

    return new PaginatedResponseDto<BackupHistoryItem>(
      items,
      total,
      query?.page ?? 1,
      query?.pageSize ?? 25,
    );
  }

  async triggerManual(connectionId: string, user: AuthUser): Promise<BackupResult> {
    return this.createBackup({ connectionId }, user, BackupCategory.MANUAL);
  }

  async listEnrichedDumps(
    connectionSlug: string,
    category: BackupCategory,
  ): Promise<EnrichedR2Object[]> {
    const connection = await this.connectionsService.findBySlug(connectionSlug);

    const prefix = `${connection.slug}/${category}/`;
    const objects = await this.r2Service.list(prefix);

    return objects
      .filter((obj) => obj.key.endsWith('.dump'))
      // R2 ListObjectsV2 returns keys in ascending lexicographic order (oldest
      // first). Sort newest-first so downstream "N most recent" slices keep the
      // latest dumps instead of dropping them.
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
      .map((obj) => {
        const filename = obj.key.split('/').pop() ?? '';
        const timestamp = filename.replace(/\.dump$/, '');

        return {
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified,
          etag: obj.etag,
          connectionId: connection.id,
          connectionSlug: connection.slug,
          connectionName: connection.name,
          dbType: connection.dbType,
          category,
          timestamp,
        };
      });
  }

  async listDumpsFromR2(): Promise<R2Object[]> {
    const objects = await this.r2Service.list();
    return objects.filter((obj) => obj.key.endsWith('.dump'));
  }

  async getBackupById(
    id: string,
  ): Promise<BackupHistoryItem> {
    const job = await this.backupRepository.findById(id);
    if (!job) {
      throw new NotFoundException(`Backup job con ID "${id}" no encontrado`);
    }

    let connectionName = '(eliminada)';
    try {
      const connection = await this.connectionsService.findById(job.connectionId);
      connectionName = connection.name;
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
    }

    return {
      ...job,
      connectionName,
    };
  }

  async getDownloadUrl(id: string): Promise<{ url: string; fileKey: string }> {
    const job = await this.backupRepository.findById(id);
    if (!job) {
      throw new NotFoundException(`Backup job con ID "${id}" no encontrado`);
    }
    if (job.status !== JobStatus.COMPLETED || !job.fileKey) {
      throw new BadRequestException(
        `El backup "${id}" no tiene un archivo disponible para descarga`,
      );
    }
    const url = await this.r2Service.getSignedUrl(job.fileKey, 900);
    return { url, fileKey: job.fileKey };
  }

  private async captureSourceSnapshot(
    connection: ConnectionEntity,
  ): Promise<DumpManifestSource> {
    if (connection.dbType === DbTypeEnum.MYSQL) {
      return this.captureMySQLSnapshot(connection);
    }
    return this.capturePostgresSnapshot(connection);
  }

  private async capturePostgresSnapshot(
    connection: ConnectionEntity,
  ): Promise<DumpManifestSource> {
    const client = new Client({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectionTimeoutMillis: 10_000,
    });

    try {
      await client.connect();

      const versionResult = await client.query<{ version: string }>(
        'SHOW server_version',
      );
      const serverVersion = versionResult.rows[0]?.version ?? 'unknown';

      const tablesResult = await client.query<{
        name: string;
        estimated_rows: string;
      }>(`
        SELECT schemaname || '.' || relname AS name,
               COALESCE(n_live_tup, 0) AS estimated_rows
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
      `);

      const tables = tablesResult.rows.map((r) => ({
        name: r.name,
        estimatedRows: Number(r.estimated_rows),
      }));

      return {
        serverVersion,
        tableCount: tables.length,
        estimatedRows: tables.reduce((sum, t) => sum + t.estimatedRows, 0),
        tables,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async captureMySQLSnapshot(
    connection: ConnectionEntity,
  ): Promise<DumpManifestSource> {
    const conn = await createMysqlConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectTimeout: 10_000,
    });

    try {
      const [versionRows] = await conn.query<(RowDataPacket & { v: string })[]>(
        'SELECT VERSION() AS v',
      );
      const serverVersion = versionRows[0]?.v ?? 'unknown';

      const [tableRows] = await conn.query<
        (RowDataPacket & { name: string; estimated_rows: string })[]
      >(`
        SELECT TABLE_NAME AS name, COALESCE(TABLE_ROWS, 0) AS estimated_rows
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_ROWS DESC
      `);

      const tables = tableRows.map((r) => ({
        name: r.name,
        estimatedRows: Number(r.estimated_rows),
      }));

      return {
        serverVersion,
        tableCount: tables.length,
        estimatedRows: tables.reduce((sum, t) => sum + t.estimatedRows, 0),
        tables,
      };
    } finally {
      await conn.end();
    }
  }

  async cancelBackup(
    id: string,
    _user: AuthUser,
  ): Promise<{ message: string; jobId: string; status: JobStatus }> {
    const job = await this.backupRepository.findById(id);
    if (!job) {
      throw new NotFoundException(`Backup job "${id}" no encontrado`);
    }

    if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
      throw new ConflictException(
        `No se puede cancelar un trabajo de respaldo con estado "${job.status}".`,
      );
    }

    const completedAt = new Date();
    const errorMessage = 'Operación cancelada por el usuario';

    if (job.status === JobStatus.PENDING) {
      try {
        const bullJob = await this.backupQueue.getJob(job.id);
        if (bullJob) {
          await bullJob.remove();
        }
      } catch (queueErr) {
        this.logger.warn(`Could not remove pending backup job ${job.id} from BullMQ: ${queueErr}`);
      }

      await this.backupRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      });

      if (job.fileKey) {
        await this.r2Service.delete(job.fileKey).catch(() => {});
      }

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
        message: 'Respaldo cancelado exitosamente',
        jobId: job.id,
        status: JobStatus.FAILED,
      };
    }

    const active = this.activeBackups.get(job.id);
    if (active) {
      active.abort({ kind: 'cancelled' });
    } else {
      await this.backupRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      });
      if (job.fileKey) {
        await this.r2Service.delete(job.fileKey).catch(() => {});
      }
      this.sseService.emit(job.id, {
        type: 'failed',
        payload: { jobId: job.id, error: errorMessage },
      });
      this.sseService.complete(job.id);
    }

    return {
      message: 'Respaldo cancelado exitosamente',
      jobId: job.id,
      status: JobStatus.FAILED,
    };
  }
}
