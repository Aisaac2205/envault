import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobsAnalyticsRepository } from './jobs-analytics.repository';
import { buildUtcDayRange, nextUtcDay, parseDailyRow, zeroFillDailySeries } from './daily-series';
import { AnalyticsWindow, ConnectionStorage, DailyBackupSeries, RestoreStatusCounts } from './jobs-analytics.types';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { JobStatus } from '../../../database/enums/job-status.enum';

export const DEFAULT_ANALYTICS_WINDOW: AnalyticsWindow = 30;

@Injectable()
export class JobsAnalyticsService {
  constructor(
    private readonly repository: JobsAnalyticsRepository,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  async getDailySeries(window: AnalyticsWindow = DEFAULT_ANALYTICS_WINDOW): Promise<DailyBackupSeries> {
    const days = buildUtcDayRange(new Date(), window);
    const from = days[0];
    const toExclusive = nextUtcDay(days[days.length - 1]);

    const rawRows = await this.repository.getDailyBackupRows({ from, toExclusive });
    const parsedRows = rawRows.map(parseDailyRow);

    return {
      window,
      from,
      to: days[days.length - 1],
      timezone: 'UTC',
      days: zeroFillDailySeries(days, parsedRows),
    };
  }

  async getStorageByConnection(): Promise<ConnectionStorage[]> {
    const rows = await this.repository.getStorageByConnection();
    if (rows.length === 0) return [];

    const ids = [...new Set(rows.map((row) => row.connectionId))];
    const connections = await this.connectionRepository.findBy({ id: In(ids) });
    const nameMap = new Map(connections.map((c) => [c.id, c.name]));

    return rows.map((row) => ({
      connectionId: row.connectionId,
      connectionName: nameMap.get(row.connectionId) ?? null,
      totalSizeMb: row.totalSizeMb,
      backupCount: Number(row.backupCount),
    }));
  }

  async getRestoreStatusCounts(): Promise<RestoreStatusCounts> {
    const rows = await this.repository.countRestoreJobsByStatus();

    const counts: Record<JobStatus, number> = {
      [JobStatus.PENDING]: 0,
      [JobStatus.RUNNING]: 0,
      [JobStatus.COMPLETED]: 0,
      [JobStatus.FAILED]: 0,
    };

    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }

    return {
      pending: counts[JobStatus.PENDING],
      running: counts[JobStatus.RUNNING],
      completed: counts[JobStatus.COMPLETED],
      failed: counts[JobStatus.FAILED],
      total: Object.values(counts).reduce((sum, n) => sum + n, 0),
    };
  }
}
