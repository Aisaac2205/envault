import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JobsAnalyticsRepository } from './jobs-analytics.repository';
import { cronIntervalSeconds } from './cron-interval';
import { buildUtcDayRange, nextUtcDay, parseDailyRow, roundTo, zeroFillDailySeries } from './daily-series';
import {
  ActiveConnectionRawRow,
  AnalyticsWindow,
  ConnectionHealth,
  ConnectionLastBackup,
  ConnectionSchedule,
  ConnectionStorage,
  ConnectionsHealth,
  DailyBackupSeries,
  Freshness,
  LatestBackupRawRow,
  RestoreStatusCounts,
  ScheduleRawRow,
  WindowBackupStats,
  WindowStatsRawRow,
} from './jobs-analytics.types';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { JobStatus } from '../../../database/enums/job-status.enum';

export const DEFAULT_ANALYTICS_WINDOW: AnalyticsWindow = 30;

/** A success no older than this many schedule intervals is fresh (`ok`). */
const OK_INTERVALS = 1.5;
/** Past `OK_INTERVALS` and up to this many intervals it is `late`; beyond, `stale`. */
const LATE_INTERVALS = 3;

const EMPTY_WINDOW_STATS: WindowBackupStats = {
  completed: 0,
  failed: 0,
  successRate: null,
  p50DurationSeconds: null,
  p95DurationSeconds: null,
};

// A fixed locale keeps the order the same on every host: names compare ignoring
// case and accents, and ties fall back to the exact name and then the id.
const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });

function compareConnections(a: ActiveConnectionRawRow, b: ActiveConnectionRawRow): number {
  return (
    NAME_COLLATOR.compare(a.connectionName, b.connectionName) ||
    (a.connectionName < b.connectionName ? -1 : a.connectionName > b.connectionName ? 1 : 0) ||
    (a.connectionId < b.connectionId ? -1 : a.connectionId > b.connectionId ? 1 : 0)
  );
}

function toWindowStats(row: WindowStatsRawRow | undefined): WindowBackupStats {
  if (!row) return { ...EMPTY_WINDOW_STATS };
  const completed = Number(row.completed);
  const failed = Number(row.failed);
  const finished = completed + failed;

  return {
    completed,
    failed,
    successRate: finished === 0 ? null : roundTo(completed / finished, 4),
    p50DurationSeconds: row.p50 === null ? null : roundTo(row.p50, 1),
    p95DurationSeconds: row.p95 === null ? null : roundTo(row.p95, 1),
  };
}

function toLastBackup(row: LatestBackupRawRow | undefined): ConnectionLastBackup | null {
  if (!row) return null;
  return {
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    durationSeconds: row.durationSeconds === null ? null : roundTo(row.durationSeconds, 1),
    fileSizeMb: row.fileSizeMb === null ? null : roundTo(row.fileSizeMb, 2),
  };
}

function toSchedule(row: ScheduleRawRow, now: Date): ConnectionSchedule {
  return {
    cronjobId: row.cronjobId,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastStatus: row.lastStatus,
    intervalSeconds: cronIntervalSeconds(row.cronExpression, now),
  };
}

/**
 * How the last success compares with the tightest active schedule: `ok` up to
 * 1.5 intervals old, `late` up to 3, `stale` beyond or when a schedule never
 * succeeded. Without an active schedule, or when none yields an interval,
 * there is nothing to compare against: `unknown`.
 */
function resolveFreshness(schedules: ConnectionSchedule[], lastSuccessAt: Date | null, now: Date): Freshness {
  const intervals = schedules
    .map((schedule) => schedule.intervalSeconds)
    .filter((interval): interval is number => interval !== null && interval > 0);
  if (intervals.length === 0) return 'unknown';
  if (lastSuccessAt === null) return 'stale';

  const intervalMs = Math.min(...intervals) * 1000;
  const ageMs = now.getTime() - lastSuccessAt.getTime();
  if (ageMs <= OK_INTERVALS * intervalMs) return 'ok';
  if (ageMs <= LATE_INTERVALS * intervalMs) return 'late';
  return 'stale';
}

@Injectable()
export class JobsAnalyticsService {
  constructor(
    private readonly repository: JobsAnalyticsRepository,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  /** Omitting `connectionId` aggregates every connection; the series echoes it as null. */
  async getDailySeries(
    window: AnalyticsWindow = DEFAULT_ANALYTICS_WINDOW,
    connectionId?: string,
  ): Promise<DailyBackupSeries> {
    const days = buildUtcDayRange(new Date(), window);
    const from = days[0];
    const toExclusive = nextUtcDay(days[days.length - 1]);
    const scopedConnectionId = connectionId ?? null;

    const rawRows = await this.repository.getDailyBackupRows({ from, toExclusive, connectionId: scopedConnectionId });
    const parsedRows = rawRows.map(parseDailyRow);

    return {
      window,
      from,
      to: days[days.length - 1],
      timezone: 'UTC',
      connectionId: scopedConnectionId,
      days: zeroFillDailySeries(days, parsedRows),
    };
  }

  /**
   * Per-database health over the window plus the overall figures. `now` fixes
   * the window's last day and the clock the freshness is measured against.
   */
  async getConnectionsHealth(
    window: AnalyticsWindow = DEFAULT_ANALYTICS_WINDOW,
    now: Date = new Date(),
  ): Promise<ConnectionsHealth> {
    const days = buildUtcDayRange(now, window);
    const from = days[0];
    const to = days[days.length - 1];

    const [statsRows, activeConnections] = await Promise.all([
      this.repository.getWindowStatsRows({ from, toExclusive: nextUtcDay(to) }),
      this.repository.findActiveProdConnections(),
    ]);
    const connections = [...activeConnections].sort(compareConnections);
    const ids = connections.map((connection) => connection.connectionId);
    const [latestRows, scheduleRows] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([this.repository.getLatestBackups(ids), this.repository.findActiveSchedules(ids)]);

    const statsById = new Map(statsRows.filter((row) => !row.isOverall).map((row) => [row.connectionId, row]));
    const latestById = new Map(latestRows.map((row) => [row.connectionId, row]));
    const schedulesById = new Map<string, ScheduleRawRow[]>();
    for (const row of scheduleRows) {
      schedulesById.set(row.connectionId, [...(schedulesById.get(row.connectionId) ?? []), row]);
    }

    return {
      window,
      from,
      to,
      timezone: 'UTC',
      overall: toWindowStats(statsRows.find((row) => row.isOverall)),
      connections: connections.map((connection): ConnectionHealth => {
        const latest = latestById.get(connection.connectionId);
        const schedules = (schedulesById.get(connection.connectionId) ?? []).map((row) => toSchedule(row, now));

        return {
          connectionId: connection.connectionId,
          connectionName: connection.connectionName,
          environment: connection.environment,
          dbType: connection.dbType,
          ...toWindowStats(statsById.get(connection.connectionId)),
          lastBackup: toLastBackup(latest),
          lastSuccessAt: latest?.lastSuccessAt ? latest.lastSuccessAt.toISOString() : null,
          schedules,
          freshness: resolveFreshness(schedules, latest?.lastSuccessAt ?? null, now),
        };
      }),
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
