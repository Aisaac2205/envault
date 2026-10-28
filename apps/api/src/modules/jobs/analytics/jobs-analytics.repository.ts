import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BackupJobEntity } from '../../../database/entities/backup-job.entity';
import { RestoreJobEntity } from '../../../database/entities/restore-job.entity';
import { Environment } from '../../../database/enums/environment.enum';
import { JobStatus } from '../../../database/enums/job-status.enum';
import { BACKUP_COUNT_AND_PERCENTILE_AGGREGATES, BackupAnalyticsRange, buildBackupAnalyticsSource } from './backup-analytics-source';
import {
  ActiveConnectionRawRow,
  ConnectionStorageRawRow,
  DailyBackupRawRow,
  LatestBackupRawRow,
  ScheduleRawRow,
  WindowStatsRawRow,
} from './jobs-analytics.types';

export type DailyRowsQuery = BackupAnalyticsRange;

export type WindowStatsQuery = Pick<BackupAnalyticsRange, 'from' | 'toExclusive'>;

@Injectable()
export class JobsAnalyticsRepository {
  constructor(
    @InjectRepository(BackupJobEntity)
    private readonly backupJobRepository: Repository<BackupJobEntity>,
    @InjectRepository(RestoreJobEntity)
    private readonly restoreJobRepository: Repository<RestoreJobEntity>,
  ) {}

  /**
   * Daily aggregates over the live `backup_jobs` rows plus the rollup of the
   * rows retention, reconcile or DB hygiene already deleted, so the series
   * keeps its history after a purge. The rows come from the source shared with
   * the connections health (see `buildBackupAnalyticsSource`).
   */
  getDailyBackupRows(range: DailyRowsQuery): Promise<DailyBackupRawRow[]> {
    const source = buildBackupAnalyticsSource(range);

    return this.backupJobRepository.query(
      `SELECT to_char(u."day", 'YYYY-MM-DD') AS "date",
              ${BACKUP_COUNT_AND_PERCENTILE_AGGREGATES},
              (MAX(u."duration"))::float8 AS "max",
              COALESCE(SUM(u."sizeMb"), 0)::float8 AS "totalSizeMb"
       FROM (${source.sql}) u
       GROUP BY u."day"
       ORDER BY u."day" ASC`,
      source.params,
    ) as Promise<DailyBackupRawRow[]>;
  }

  /**
   * Counts and percentiles over a whole range, per connection and overall, from
   * the same source as the daily series. The overall row (`isOverall`) is
   * always returned, with zeros and nulls when the range holds nothing; a
   * connection with no job in the range has no row of its own.
   */
  getWindowStatsRows(range: WindowStatsQuery): Promise<WindowStatsRawRow[]> {
    const source = buildBackupAnalyticsSource(range);

    return this.backupJobRepository.query(
      `SELECT (GROUPING(u."connectionId") = 1) AS "isOverall",
              u."connectionId" AS "connectionId",
              ${BACKUP_COUNT_AND_PERCENTILE_AGGREGATES}
       FROM (${source.sql}) u
       GROUP BY GROUPING SETS ((u."connectionId"), ())`,
      source.params,
    ) as Promise<WindowStatsRawRow[]>;
  }

  /**
   * Active production connections. Only the columns the health view needs are
   * read: the entity would decrypt every password for nothing. Backups are
   * only allowed for production, hence the environment filter.
   */
  findActiveProdConnections(): Promise<ActiveConnectionRawRow[]> {
    return this.backupJobRepository.query(
      `SELECT c.id::text AS "connectionId",
              c.name AS "connectionName",
              c.environment::text AS "environment",
              c."dbType"::text AS "dbType"
       FROM connections c
       WHERE c."isActive" = true AND c.environment = $1
       ORDER BY c.name ASC, c.id ASC`,
      [Environment.PROD],
    ) as Promise<ActiveConnectionRawRow[]>;
  }

  /**
   * The latest completed or failed backup of each connection, of any age, and
   * the completion of its latest success. Pending and running rows are not
   * outcomes yet. The tz-less timestamp columns hold UTC wall-clock time, as
   * the daily series assumes, so they are read as UTC whatever the session
   * TimeZone or the host's clock.
   */
  getLatestBackups(connectionIds: string[]): Promise<LatestBackupRawRow[]> {
    return this.backupJobRepository.query(
      `WITH "lastOutcome" AS (
         SELECT DISTINCT ON (j."connectionId")
                j."connectionId", j.status, j."createdAt", j."startedAt", j."completedAt", j."fileSizeMb"
         FROM backup_jobs j
         WHERE j."connectionId" = ANY($1::text[]) AND j.status IN ($2, $3)
         ORDER BY j."connectionId", j."createdAt" DESC, j.id DESC
       ),
       "lastSuccess" AS (
         SELECT DISTINCT ON (j."connectionId") j."connectionId", j."completedAt"
         FROM backup_jobs j
         WHERE j."connectionId" = ANY($1::text[]) AND j.status = $2 AND j."completedAt" IS NOT NULL
         ORDER BY j."connectionId", j."completedAt" DESC, j.id DESC
       )
       SELECT o."connectionId" AS "connectionId",
              o.status::text AS "status",
              (o."createdAt" AT TIME ZONE 'UTC') AS "createdAt",
              (o."completedAt" AT TIME ZONE 'UTC') AS "completedAt",
              (CASE WHEN o."startedAt" IS NOT NULL AND o."completedAt" IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (o."completedAt" - o."startedAt")) END)::float8 AS "durationSeconds",
              o."fileSizeMb"::float8 AS "fileSizeMb",
              (s."completedAt" AT TIME ZONE 'UTC') AS "lastSuccessAt"
       FROM "lastOutcome" o
       LEFT JOIN "lastSuccess" s ON s."connectionId" = o."connectionId"`,
      [connectionIds, JobStatus.COMPLETED, JobStatus.FAILED],
    ) as Promise<LatestBackupRawRow[]>;
  }

  /** The active cronjobs of the given connections, oldest first. */
  findActiveSchedules(connectionIds: string[]): Promise<ScheduleRawRow[]> {
    return this.backupJobRepository.query(
      `SELECT cj.id::text AS "cronjobId",
              cj."connectionId" AS "connectionId",
              cj."cronExpression" AS "cronExpression",
              (cj."nextRunAt" AT TIME ZONE 'UTC') AS "nextRunAt",
              (cj."lastRunAt" AT TIME ZONE 'UTC') AS "lastRunAt",
              cj."lastStatus"::text AS "lastStatus"
       FROM cronjobs cj
       WHERE cj."isActive" = true AND cj."connectionId" = ANY($1::text[])
       ORDER BY cj."createdAt" ASC, cj.id ASC`,
      [connectionIds],
    ) as Promise<ScheduleRawRow[]>;
  }

  getStorageByConnection(): Promise<ConnectionStorageRawRow[]> {
    return this.backupJobRepository
      .createQueryBuilder('j')
      .select('j."connectionId"', 'connectionId')
      // No COALESCE needed: the outer WHERE below already restricts every
      // grouped row to `completed`, so a group can only exist with >=1 row
      // and SUM(j."fileSizeMb") can never be NULL here.
      .addSelect('SUM(j."fileSizeMb")::float8', 'totalSizeMb')
      .addSelect('COUNT(*)', 'backupCount')
      .where('j.status = :completed', { completed: JobStatus.COMPLETED })
      .groupBy('j."connectionId"')
      .orderBy('"totalSizeMb"', 'DESC')
      .addOrderBy('j."connectionId"', 'ASC')
      .getRawMany<ConnectionStorageRawRow>();
  }

  countRestoreJobsByStatus(): Promise<{ status: JobStatus; count: string }[]> {
    return this.restoreJobRepository
      .createQueryBuilder('restore_job')
      .select('restore_job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('restore_job.status')
      .getRawMany();
  }
}
