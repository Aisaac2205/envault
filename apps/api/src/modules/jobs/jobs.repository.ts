import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { RestoreJobEntity } from '../../database/entities/restore-job.entity';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { JobStatus } from '../../database/enums/job-status.enum';
import { Environment } from '../../database/enums/environment.enum';

export interface JobFilters {
  status?: JobStatus;
  environment?: Environment;
  from?: Date;
  to?: Date;
  limit?: number;
}

@Injectable()
export class JobsRepository {
  constructor(
    @InjectRepository(BackupJobEntity)
    private readonly backupJobRepository: Repository<BackupJobEntity>,
    @InjectRepository(RestoreJobEntity)
    private readonly restoreJobRepository: Repository<RestoreJobEntity>,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  async findAllBackupJobs(filters?: JobFilters): Promise<(BackupJobEntity & { connectionName: string | null })[]> {
    const where = this.buildBackupWhere(filters);
    const jobs = await this.backupJobRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: filters?.limit,
    });

    if (jobs.length === 0) return [];

    const ids = [...new Set(jobs.map((j) => j.connectionId))];
    const connections = await this.connectionRepository.findBy({ id: In(ids) });
    const nameMap = new Map(connections.map((c) => [c.id, c.name]));

    return jobs.map((j) => Object.assign(j, { connectionName: nameMap.get(j.connectionId) ?? null }));
  }

  findAllRestoreJobs(filters?: JobFilters): Promise<RestoreJobEntity[]> {
    const where = this.buildRestoreWhere(filters);
    return this.restoreJobRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: filters?.limit,
    });
  }

  findBackupJobById(id: string): Promise<BackupJobEntity | null> {
    return this.backupJobRepository.findOne({ where: { id } });
  }

  findRestoreJobById(id: string): Promise<RestoreJobEntity | null> {
    return this.restoreJobRepository.findOne({ where: { id } });
  }

  countBackupJobsByStatus(): Promise<{ status: JobStatus; count: string }[]> {
    return this.backupJobRepository
      .createQueryBuilder('backup_job')
      .select('backup_job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('backup_job.status')
      .getRawMany();
  }

  countRestoreJobsByStatus(): Promise<{ status: JobStatus; count: string }[]> {
    return this.restoreJobRepository
      .createQueryBuilder('restore_job')
      .select('restore_job.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('restore_job.status')
      .getRawMany();
  }

  async getStats(): Promise<{
    successRate30d: number;
    backupsToday: number;
    failed7d: number;
    totalStorageR2Mb: number;
  }> {
    const aggregateRow = await this.backupJobRepository
      .createQueryBuilder('j')
      .select('COUNT(*) FILTER (WHERE j."createdAt" >= NOW() - INTERVAL \'30 days\')', 'total30d')
      .addSelect(
        'COUNT(*) FILTER (WHERE j.status = :completed AND j."createdAt" >= NOW() - INTERVAL \'30 days\')',
        'completed30d',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE j.status = :failed AND j."createdAt" >= NOW() - INTERVAL \'7 days\')',
        'failed7d',
      )
      .addSelect('COALESCE(SUM(j."fileSizeMb") FILTER (WHERE j.status = :completed), 0)', 'totalStorageR2Mb')
      .setParameters({ completed: JobStatus.COMPLETED, failed: JobStatus.FAILED })
      .getRawOne<{ total30d: string; completed30d: string; failed7d: string; totalStorageR2Mb: string }>();

    const total30d = Number(aggregateRow?.total30d ?? 0);
    const completed30d = Number(aggregateRow?.completed30d ?? 0);
    const successRate30d = total30d > 0 ? Math.round((completed30d / total30d) * 1000) / 10 : 0;

    const todayRow = await this.backupJobRepository
      .createQueryBuilder('j')
      .select('COUNT(*)', 'backupsToday')
      .where('j.status = :completed', { completed: JobStatus.COMPLETED })
      .andWhere('DATE(j."createdAt") = CURRENT_DATE')
      .getRawOne<{ backupsToday: string }>();

    return {
      successRate30d,
      backupsToday: Number(todayRow?.backupsToday ?? 0),
      failed7d: Number(aggregateRow?.failed7d ?? 0),
      totalStorageR2Mb: Math.round(Number(aggregateRow?.totalStorageR2Mb ?? 0) * 10) / 10,
    };
  }

  async getDailyCounts(): Promise<{ date: string; scheduled: number; manual: number }[]> {
    const rows = await this.backupJobRepository
      .createQueryBuilder('j')
      .select('DATE(j."createdAt")::text', 'date')
      .addSelect('COUNT(*) FILTER (WHERE j."triggeredBy" = \'system-cronjob\')', 'scheduled')
      .addSelect('COUNT(*) FILTER (WHERE j."triggeredBy" != \'system-cronjob\')', 'manual')
      .where('j.status = :completed', { completed: JobStatus.COMPLETED })
      .andWhere('j."createdAt" >= NOW() - INTERVAL \'90 days\'')
      .groupBy('DATE(j."createdAt")')
      .orderBy('DATE(j."createdAt")', 'ASC')
      .getRawMany<{ date: string; scheduled: string; manual: string }>();

    return rows.map((r) => ({
      date: r.date,
      scheduled: Number(r.scheduled),
      manual: Number(r.manual),
    }));
  }

  private buildBackupWhere(filters?: JobFilters): Record<string, unknown> {
    if (!filters) return {};

    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.environment) {
      where.environment = filters.environment;
    }

    if (filters.from && filters.to) {
      where.createdAt = Between(filters.from, filters.to);
    } else if (filters.from) {
      where.createdAt = Between(filters.from, new Date());
    } else if (filters.to) {
      where.createdAt = Between(new Date(0), filters.to);
    }

    return where;
  }

  private buildRestoreWhere(filters?: JobFilters): Record<string, unknown> {
    if (!filters) return {};

    const where: Record<string, unknown> = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.environment) {
      where.targetEnvironment = filters.environment;
    }

    if (filters.from && filters.to) {
      where.createdAt = Between(filters.from, filters.to);
    } else if (filters.from) {
      where.createdAt = Between(filters.from, new Date());
    } else if (filters.to) {
      where.createdAt = Between(new Date(0), filters.to);
    }

    return where;
  }
}
