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
}

@Injectable()
export class JobsAnalyticsRepository {
  constructor(
    @InjectRepository(BackupJobEntity)
    private readonly backupJobRepository: Repository<BackupJobEntity>,
    @InjectRepository(RestoreJobEntity)
    private readonly restoreJobRepository: Repository<RestoreJobEntity>,
  ) {}

  getDailyBackupRows({ from, toExclusive }: DailyRowsQuery): Promise<DailyBackupRawRow[]> {
    return this.backupJobRepository
      .createQueryBuilder('j')
      .select(`to_char(DATE(j."createdAt"), 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*) FILTER (WHERE j.status = :completed)', 'completed')
      .addSelect('COUNT(*) FILTER (WHERE j.status = :failed)', 'failed')
      .addSelect(
        `(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (j."completedAt" - j."startedAt"))) ` +
          `FILTER (WHERE j.status = :completed AND j."startedAt" IS NOT NULL AND j."completedAt" IS NOT NULL))::float8`,
        'p50',
      )
      .addSelect(
        `(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (j."completedAt" - j."startedAt"))) ` +
          `FILTER (WHERE j.status = :completed AND j."startedAt" IS NOT NULL AND j."completedAt" IS NOT NULL))::float8`,
        'p95',
      )
      .addSelect(`COALESCE(SUM(j."fileSizeMb") FILTER (WHERE j.status = :completed), 0)::float8`, 'totalSizeMb')
      .where('j."createdAt" >= CAST(:from AS date)', { from })
      .andWhere('j."createdAt" < CAST(:toExclusive AS date)', { toExclusive })
      .setParameters({ completed: JobStatus.COMPLETED, failed: JobStatus.FAILED })
      .groupBy('DATE(j."createdAt")')
      .orderBy('DATE(j."createdAt")', 'ASC')
      .getRawMany<DailyBackupRawRow>();
  }

  getStorageByConnection(): Promise<ConnectionStorageRawRow[]> {
    return this.backupJobRepository
      .createQueryBuilder('j')
      .select('j."connectionId"', 'connectionId')
      .addSelect('COALESCE(SUM(j."fileSizeMb"), 0)::float8', 'totalSizeMb')
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
