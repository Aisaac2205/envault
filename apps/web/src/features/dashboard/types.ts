import type { Schedule } from "@/features/cronjobs/types";

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobSummary {
  total: number;
  completed: number;
  pending: number;
  running: number;
  failed: number;
}

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

export interface CronjobEntity {
  id: string;
  name: string;
  isActive: boolean;
  /** `null` when the stored expression is one the schedule builder cannot represent. */
  schedule: Schedule | null;
  connectionId: string;
  connectionName: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "pending" | "running" | "completed" | "failed" | null;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  environment: string;
  createdAt: string;
}

export interface R2Object {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

export interface DashboardStats {
  successRate30d: number;
  backupsToday: number;
  failed7d: number;
  totalStorageMb: number;
}

export interface DailyBackupCount {
  date: string;
  scheduled: number;
  manual: number;
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

export interface RestoreStatusCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
}
