import apiClient from "@/shared/lib/api-client";
import type {
  JobSummary,
  BackupJob,
  RestoreJob,
  ConnectionEntity,
  CronjobEntity,
  HealthStatus,
  AuditLog,
  R2Object,
  DashboardStats,
  DailyBackupCount,
  AnalyticsWindow,
  DailyBackupSeries,
  ConnectionStorage,
  RestoreStatusCounts,
} from "../types";

export const dashboardApi = {
  getSummary: () =>
    apiClient.get<JobSummary>("/jobs/summary").then((r) => r.data),

  getRecentBackups: (limit = 5) =>
    apiClient
      .get<BackupJob[]>("/jobs/backups", { params: { limit } })
      .then((r) => r.data),

  getRecentRestores: (limit = 5) =>
    apiClient
      .get<RestoreJob[]>("/jobs/restores", { params: { limit } })
      .then((r) => r.data),

  getConnections: () =>
    apiClient.get<ConnectionEntity[]>("/connections").then((r) => r.data),

  getCronjobs: () =>
    apiClient.get<CronjobEntity[]>("/cronjobs").then((r) => r.data),

  getHealth: () =>
    apiClient.get<HealthStatus>("/health").then((r) => r.data),

  getRecentAudit: (limit = 10) =>
    apiClient
      .get<AuditLog[]>("/audit", { params: { pageSize: limit } })
      .then((r) => r.data),

  getDumpsFromR2: () =>
    apiClient.get<R2Object[]>("/backups/r2").then((r) => r.data),

  getStats: () =>
    apiClient.get<DashboardStats>("/jobs/stats").then((r) => r.data),

  getDailyCounts: () =>
    apiClient.get<DailyBackupCount[]>("/jobs/daily-counts").then((r) => r.data),

  // dashboard-charts-web: admin-only endpoints (apps/api/.../jobs-analytics.controller.ts).
  getDailyAnalytics: (window: AnalyticsWindow) =>
    apiClient
      .get<DailyBackupSeries>("/jobs/analytics/daily", { params: { window } })
      .then((r) => r.data),

  getStorageByConnection: () =>
    apiClient
      .get<ConnectionStorage[]>("/jobs/analytics/storage-by-connection")
      .then((r) => r.data),

  getRestoreStatusCounts: () =>
    apiClient
      .get<RestoreStatusCounts>("/jobs/analytics/restore-status")
      .then((r) => r.data),
};
