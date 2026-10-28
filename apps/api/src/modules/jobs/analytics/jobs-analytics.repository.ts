import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BackupJobEntity } from '../../../database/entities/backup-job.entity';
import { RestoreJobEntity } from '../../../database/entities/restore-job.entity';
import { JobStatus } from '../../../database/enums/job-status.enum';
import { DailyBackupRawRow, ConnectionStorageRawRow } from './jobs-analytics.types';

export interface DailyRowsQuery {
  from: string;
  toExclusive: string;
  /** Restricts the rows to one connection; null or omitted aggregates every connection. */
  connectionId?: string | null;
}

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
   * keeps its history after a purge. The two are merged per day through a
   * `UNION ALL` of three sources sharing one range and one optional connection
   * filter:
   * - live jobs, projected to one counter / size / duration per row;
   * - rollup rows, contributing completed, failed and size with no duration;
   * - the purged durations (`unnest`), contributing only a duration.
   *
   * `percentile_cont` and `MAX` ignore NULL durations, so the result is exactly
   * what the live-only query returned before the purge.
   */
  getDailyBackupRows({ from, toExclusive, connectionId }: DailyRowsQuery): Promise<DailyBackupRawRow[]> {
    const params: unknown[] = [from, toExclusive, JobStatus.COMPLETED, JobStatus.FAILED];
    if (connectionId) params.push(connectionId);
    const liveFilter = connectionId ? ' AND j."connectionId" = $5' : '';
    const rollupFilter = connectionId ? ' AND r."connectionId" = $5' : '';
    const rollupRange = `r."day" >= CAST($1 AS date) AND r."day" < CAST($2 AS date)${rollupFilter}`;

    return this.backupJobRepository.query(
      `SELECT to_char(u."day", 'YYYY-MM-DD') AS "date",
              COALESCE(SUM(u."completed"), 0)::bigint AS "completed",
              COALESCE(SUM(u."failed"), 0)::bigint AS "failed",
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY u."duration")
                 FILTER (WHERE u."duration" IS NOT NULL))::float8 AS "p50",
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY u."duration")
                 FILTER (WHERE u."duration" IS NOT NULL))::float8 AS "p95",
              (MAX(u."duration"))::float8 AS "max",
              COALESCE(SUM(u."sizeMb"), 0)::float8 AS "totalSizeMb"
       FROM (
         SELECT DATE(j."createdAt") AS "day",
                (j.status = $3)::int AS "completed",
                (j.status = $4)::int AS "failed",
                (CASE WHEN j.status = $3 THEN COALESCE(j."fileSizeMb", 0) ELSE 0 END)::float8 AS "sizeMb",
                (CASE WHEN j.status = $3 AND j."startedAt" IS NOT NULL AND j."completedAt" IS NOT NULL
                      THEN EXTRACT(EPOCH FROM (j."completedAt" - j."startedAt")) END)::float8 AS "duration"
         FROM backup_jobs j
         WHERE j."createdAt" >= CAST($1 AS date) AND j."createdAt" < CAST($2 AS date)${liveFilter}
         UNION ALL
         SELECT r."day", r."completed", r."failed", r."totalSizeMb", NULL::float8
         FROM backup_daily_rollups r
         WHERE ${rollupRange}
         UNION ALL
         SELECT r."day", 0, 0, 0::float8, d."duration"
         FROM backup_daily_rollups r
         CROSS JOIN LATERAL unnest(r."durationsSeconds") AS d("duration")
         WHERE ${rollupRange}
       ) u
       GROUP BY u."day"
       ORDER BY u."day" ASC`,
      params,
    ) as Promise<DailyBackupRawRow[]>;
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
