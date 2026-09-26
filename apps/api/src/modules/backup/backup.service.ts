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
import { Queue } from 'bullmq';
import { Readable } from 'stream';
import { Client } from 'pg';
import { createConnection as createMysqlConnection, RowDataPacket } from 'mysql2/promise';
import { sanitizeMessage } from '../../common/sanitization/sanitize-message';
import { CreateBackupDto } from './dto/create-backup.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { BackupRepository } from './backup.repository';
import { R2Service } from './r2.service';
import { BACKUP_QUEUE_NAME } from './backup.constants';
import { SseService } from '../../shared/sse/sse.service';
import { BackupResult } from './interfaces/backup-result.interface';
import { BackupHistoryItem } from './interfaces/backup-history-item.interface';
import { R2Object } from './interfaces/r2-object.interface';
import { EnrichedR2Object } from './interfaces/enriched-r2-object.interface';
import { BackupStrategy } from './interfaces/backup-strategy.interface';
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
  private readonly activeBackups = new Map<string, AbortController>();
  private readonly activeConnectionDumps = new Set<string>();
  private readonly backupTimeoutMs: number;

  constructor(
    private readonly backupRepository: BackupRepository,
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
        `Detectados ${unfinished.length} respaldos sin finalizar al iniciar el proceso. Limpiando huérfanos...`,
      );

      for (const job of unfinished) {
        await this.backupRepository.updateStatus(job.id, JobStatus.FAILED, {
          errorMessage: 'Respaldo interrumpido por reinicio o detención del servicio',
          completedAt: new Date(),
        });
        this.logger.warn(
          `Respaldo huérfano ${job.id} (conexión ${job.connectionId}) marcado como FAILED`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error en sweepOrphans de BackupService: ${message}`);
    }
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

    const activeJob = await this.backupRepository.findActiveJobForConnection(connection.id);
    if (activeJob) {
      const jobAgeMs = Date.now() - (activeJob.startedAt ?? activeJob.createdAt).getTime();
      if (jobAgeMs > this.backupTimeoutMs) {
        this.logger.warn(
          `Respaldo activo previo ${activeJob.id} superó el timeout (${jobAgeMs}ms > ${this.backupTimeoutMs}ms). Marcando como FAILED.`,
        );
        await this.backupRepository.updateStatus(activeJob.id, JobStatus.FAILED, {
          errorMessage: 'Respaldo superó el tiempo límite de ejecución (timeout)',
          completedAt: new Date(),
        });
      } else if (activeJob.status === JobStatus.PENDING) {
        this.logger.log(
          `Ya existe un respaldo en cola para la conexión "${connection.name}" (Job: ${activeJob.id}). Reutilizando ticket de cola.`,
        );
        return {
          jobId: activeJob.id,
          fileKey: activeJob.fileKey ?? '',
          status: JobStatus.PENDING,
        };
      } else {
        this.logger.log(
          `Conexión "${connection.name}" tiene un respaldo en ejecución (Job: ${activeJob.id}). Encolando nuevo respaldo para ejecución secuencial.`,
        );
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    const fileKey = `${connection.slug}/${category}/${timestamp}-${uniqueSuffix}.dump`;

    const job = await this.backupRepository.create({
      connectionId: connection.id,
      environment: connection.environment,
      dbType: connection.dbType,
      status: JobStatus.PENDING,
      fileKey,
      triggeredBy: user.id,
      category,
      storageKeyVersion: STORAGE_KEY_VERSION.NEW,
    });

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
      await this.backupRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage: `Fallo al encolar en Redis: ${errorMessage}`,
        completedAt: new Date(),
      });
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

  async executeQueuedBackup(jobId: string): Promise<BackupResult> {
    const job = await this.backupRepository.findById(jobId);
    if (!job) {
      this.logger.error(`Backup job ${jobId} not found in database`);
      throw new NotFoundException(`Backup job "${jobId}" no encontrado`);
    }

    if (job.status === JobStatus.COMPLETED) {
      this.logger.warn(`Backup job ${jobId} ya estaba completado.`);
      return {
        jobId: job.id,
        fileKey: job.fileKey!,
        fileSizeMb: job.fileSizeMb ?? undefined,
        sha256: job.sha256 ?? undefined,
        bytes: job.bytes ?? undefined,
        status: JobStatus.COMPLETED,
      };
    }

    const connection = await this.connectionsService.findById(job.connectionId);
    const strategy = this.backupStrategies.get(connection.dbType);
    if (!strategy) {
      throw new BadRequestException(
        `No hay estrategia de backup configurada para tipo "${connection.dbType}"`,
      );
    }

    const abortController = new AbortController();
    this.activeBackups.set(job.id, abortController);

    while (this.activeConnectionDumps.has(connection.id)) {
      if (abortController.signal.aborted) {
        throw new Error('Operación cancelada por el usuario');
      }
      this.logger.log(
        `Conexión "${connection.name}" está ejecutando otro volcado. Esperando liberación de conexión para job ${job.id}...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    this.activeConnectionDumps.add(connection.id);

    const startedAt = new Date();
    await this.backupRepository.updateStatus(job.id, JobStatus.RUNNING, {
      startedAt,
    });

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

    try {
      if (abortController.signal.aborted) {
        throw new Error('Operación cancelada por el usuario');
      }

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

      await this.backupRepository.updateStatus(job.id, JobStatus.COMPLETED, {
        fileSizeMb: backupResult.fileSizeMb,
        sha256: backupResult.sha256,
        bytes: backupResult.bytes,
        completedAt,
      });

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
        jobId: job.id,
        fileKey: job.fileKey!,
        fileSizeMb: backupResult.fileSizeMb,
        sha256: backupResult.sha256,
        bytes: backupResult.bytes,
        startedAt,
        completedAt,
        status: JobStatus.COMPLETED,
      };
    } catch (error) {
      const completedAt = new Date();
      const rawMessage =
        error instanceof Error ? error.message : 'Error desconocido en backup';
      const errorMessage = sanitizeMessage(rawMessage);

      this.logger.error(`Backup failed for connection ${connection.id}: ${errorMessage}`);

      await this.r2Service.delete(job.fileKey!).catch(() => {});

      await this.backupRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      });

      this.sseService.emit(job.id, {
        type: 'failed',
        payload: { jobId: job.id, error: errorMessage },
      });
      this.sseService.complete(job.id);

      if (rawMessage.includes('Operación cancelada por el usuario')) {
        return {
          jobId: job.id,
          fileKey: job.fileKey!,
          status: JobStatus.FAILED,
        };
      }

      throw new InternalServerErrorException(
        `Backup failed for job ${job.id}: ${errorMessage}`,
      );
    } finally {
      this.activeConnectionDumps.delete(connection.id);
      this.activeBackups.delete(job.id);
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

    const controller = this.activeBackups.get(job.id);
    if (controller) {
      controller.abort();
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
