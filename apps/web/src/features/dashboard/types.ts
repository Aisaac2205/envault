export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface BackupJob {
  id: string;
  connectionId: string;
  connectionName: string;
  environment: string;
  status: JobStatus;
  fileKey: string | null;
  fileSizeMb: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  createdAt: string;
}

export interface RestoreJob {
  id: string;
  targetConnectionId: string;
  targetEnvironment: string;
  isDryRun: boolean;
  status: JobStatus;
  createdAt: string;
}

export interface ConnectionEntity {
  id: string;
  name: string;
  dbType: string;
  environment: string;
  isActive: boolean;
}

export type AnalyticsWindow = 7 | 30 | 90;

export interface DailyBackupPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  completed: number;
  failed: number;
  /** `null` when no backup completed that day. */
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  maxDurationSeconds: number | null;
  totalSizeMb: number;
}

export interface DailyBackupSeries {
  window: AnalyticsWindow;
  from: string;
  to: string;
  timezone: "UTC";
  /** The connection the series is scoped to, or `null` when it covers every connection. */
  connectionId: string | null;
  /** Zero-filled: one entry per calendar day of the window. */
  days: DailyBackupPoint[];
}

export interface ConnectionStorage {
  connectionId: string;
  connectionName: string | null;
  totalSizeMb: number;
  backupCount: number;
}

/** How recently a connection last backed up successfully, relative to its schedule. */
export type Freshness = "ok" | "late" | "stale" | "unknown";

/** Counts and duration percentiles over a window, for one connection or for all of them. */
export interface WindowBackupStats {
  completed: number;
  failed: number;
  /** completed / (completed + failed) as a 0 to 1 fraction; `null` when nothing finished in the window. */
  successRate: number | null;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
}

export interface ConnectionLastBackup {
  status: "completed" | "failed";
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
  /** The largest gap between two runs of the schedule, in seconds; `null` when the expression is invalid. */
  intervalSeconds: number | null;
}

export interface ConnectionHealth extends WindowBackupStats {
  connectionId: string;
  connectionName: string;
  environment: string;
  dbType: string;
  /** The latest completed or failed backup of any age. */
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
  timezone: "UTC";
  /** Every connection, so it can exceed the sum of the production ones listed. */
  overall: WindowBackupStats;
  /** Active production connections, ordered by name. */
  connections: ConnectionHealth[];
}
