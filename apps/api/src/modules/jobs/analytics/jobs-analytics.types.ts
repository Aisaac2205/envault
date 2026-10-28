import { JobStatus } from '../../../database/enums/job-status.enum';

export const ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

export interface DailyBackupPoint {
  date: string;
  completed: number;
  failed: number;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  maxDurationSeconds: number | null;
  totalSizeMb: number;
}

export interface DailyBackupSeries {
  window: AnalyticsWindow;
  from: string;
  to: string;
  timezone: 'UTC';
  /** The connection the series is scoped to, or null when it covers every connection. */
  connectionId: string | null;
  days: DailyBackupPoint[];
}

export interface ConnectionStorage {
  connectionId: string;
  connectionName: string | null;
  totalSizeMb: number;
  backupCount: number;
}

export interface RestoreStatusCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}

/** How recently a connection last backed up successfully, relative to its schedule. */
export type Freshness = 'ok' | 'late' | 'stale' | 'unknown';

export interface ConnectionLastBackup {
  status: JobStatus.COMPLETED | JobStatus.FAILED;
  createdAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  fileSizeMb: number | null;
}

export interface ConnectionSchedule {
  cronjobId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  /** Seconds between the next two occurrences of the cron expression; null when it is invalid. */
  intervalSeconds: number | null;
}

/** Counts and duration percentiles over the window, for one connection or for all of them. */
export interface WindowBackupStats {
  completed: number;
  failed: number;
  /** completed / (completed + failed), 0..1; null when nothing completed or failed. */
  successRate: number | null;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
}

export interface ConnectionHealth extends WindowBackupStats {
  connectionId: string;
  connectionName: string;
  environment: string;
  dbType: string;
  /** The latest completed or failed backup of any age; pending and running ones are ignored. */
  lastBackup: ConnectionLastBackup | null;
  lastSuccessAt: string | null;
  /** Active cronjobs only. */
  schedules: ConnectionSchedule[];
  freshness: Freshness;
}

export interface ConnectionsHealth {
  window: AnalyticsWindow;
  from: string;
  to: string;
  timezone: 'UTC';
  /** Every connection of the source, including inactive ones: it equals the sum of the daily series. */
  overall: WindowBackupStats;
  /** Active production connections, ordered by name. */
  connections: ConnectionHealth[];
}

/**
 * Raw shape node-pg returns for the window statistics query: one row per
 * connection with a job in the window, plus the overall row (`isOverall`).
 */
export interface WindowStatsRawRow {
  isOverall: boolean;
  connectionId: string | null;
  completed: string;
  failed: string;
  p50: number | null;
  p95: number | null;
}

export interface ActiveConnectionRawRow {
  connectionId: string;
  connectionName: string;
  environment: string;
  dbType: string;
}

/** The latest completed or failed backup of a connection, with the completion of its latest success. */
export interface LatestBackupRawRow {
  connectionId: string;
  status: JobStatus.COMPLETED | JobStatus.FAILED;
  createdAt: Date;
  completedAt: Date | null;
  durationSeconds: number | null;
  fileSizeMb: number | null;
  lastSuccessAt: Date | null;
}

export interface ScheduleRawRow {
  cronjobId: string;
  connectionId: string;
  cronExpression: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
}

/** Raw shape node-pg returns for the storage-by-connection query. */
export interface ConnectionStorageRawRow {
  connectionId: string;
  totalSizeMb: number;
  backupCount: string;
}

/** Raw shape node-pg returns for the daily backup query: bigint counts arrive as strings. */
export interface DailyBackupRawRow {
  date: string;
  completed: string;
  failed: string;
  p50: number | null;
  p95: number | null;
  max: number | null;
  totalSizeMb: number;
}
