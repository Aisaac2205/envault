export const ANALYTICS_WINDOWS = [7, 30, 90] as const;
export type AnalyticsWindow = (typeof ANALYTICS_WINDOWS)[number];

export interface DailyBackupPoint {
  date: string;
  completed: number;
  failed: number;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  totalSizeMb: number;
}

export interface DailyBackupSeries {
  window: AnalyticsWindow;
  from: string;
  to: string;
  timezone: 'UTC';
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
  totalSizeMb: number;
}
