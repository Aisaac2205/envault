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
  cronExpression: string;
  connectionId: string;
  connectionName: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "pending" | "running" | "completed" | "failed" | null;
}

export interface HealthStatus {
  status: string;
  info: {
    database: {
      status: string;
    };
  };
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

// dashboard-charts-web: mirrors apps/api/src/modules/jobs/analytics/jobs-analytics.types.ts.
// The backend is the source of truth; drift is caught by its @IsEnum/@IsIn validators, not by a shared type.
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
  timezone: "UTC";
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
