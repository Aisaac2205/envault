import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { Client } from 'pg';
import { createConnection as createMysqlConnection, RowDataPacket } from 'mysql2/promise';
import { sanitizeMessage } from '../../common/sanitization/sanitize-message';
import { CreateBackupDto } from './dto/create-backup.dto';
import { ListHistoryQueryDto } from './dto/list-history-query.dto';
import { BackupRepository } from './backup.repository';
import { R2Service } from './r2.service';
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
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly backupRepository: BackupRepository,
    private readonly r2Service: R2Service,
    private readonly connectionsService: ConnectionsService,
    @Inject('BACKUP_STRATEGIES')
    private readonly backupStrategies: Map<DbTypeEnum, BackupStrategy>,
  ) {}

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

    const metadata: Record<string, string> = {
      connectionId: connection.id,
      connectionSlug: connection.slug,
      category,
      environment: connection.environment,
      dbType: connection.dbType,
      triggeredBy: user.id,
    };

    const job = await this.backupRepository.create({
      connectionId: connection.id,
      environment: connection.environment,
      dbType: connection.dbType,
      status: JobStatus.PENDING,
      triggeredBy: user.id,
      category,
      storageKeyVersion: STORAGE_KEY_VERSION.NEW,
    });

    const startedAt = new Date();

    await this.backupRepository.updateStatus(job.id, JobStatus.RUNNING, {
      fileKey,
      startedAt,
    });

    try {
      // Capture source snapshot BEFORE the dump starts
      const sourceSnapshot = await this.captureSourceSnapshot(connection);

      const backupResult = await strategy.execute(connection, fileKey, metadata);

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
      const manifestKey = fileKey.replace(/\.dump$/, '.manifest.json');
      try {
        await this.r2Service.upload(
          manifestKey,
          Readable.from(JSON.stringify(manifest)),
        );
      } catch (manifestError) {
        await this.r2Service.delete(fileKey).catch(() => {});
        throw manifestError;
      }

      const completedAt = new Date();

      await this.backupRepository.updateStatus(job.id, JobStatus.COMPLETED, {
        fileSizeMb: backupResult.fileSizeMb,
        sha256: backupResult.sha256,
        bytes: backupResult.bytes,
        completedAt,
      });

      return {
        jobId: job.id,
        fileKey,
        fileSizeMb: backupResult.fileSizeMb,
        sha256: backupResult.sha256,
        bytes: backupResult.bytes,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date();
      const rawMessage =
        error instanceof Error ? error.message : 'Error desconocido en backup';
      const errorMessage = sanitizeMessage(rawMessage);

      this.logger.error(`Backup failed for connection ${connection.id}: ${errorMessage}`);

      await this.backupRepository.updateStatus(job.id, JobStatus.FAILED, {
        errorMessage,
        completedAt,
      });

      throw new InternalServerErrorException(
        `Backup failed for job ${job.id}: ${errorMessage}`,
      );
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

}
