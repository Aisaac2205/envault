import apiClient from "@/shared/lib/api-client";
import type {
  BackupJob,
  RestoreJob,
  ConnectionEntity,
  AnalyticsWindow,
  DailyBackupSeries,
  ConnectionStorage,
  ConnectionsHealth,
} from "../types";

export const dashboardApi = {
  /** The latest failed backups, newest first. */
  getRecentFailures: (limit = 5) =>
    apiClient
      .get<BackupJob[]>("/jobs/backups", { params: { status: "failed", limit } })
      .then((r) => r.data),

  getRecentRestores: (limit = 5) =>
    apiClient
      .get<RestoreJob[]>("/jobs/restores", { params: { limit } })
      .then((r) => r.data),

  getConnections: () =>
    apiClient.get<ConnectionEntity[]>("/connections").then((r) => r.data),

  getDailyAnalytics: (window: AnalyticsWindow = 30, connectionId?: string) =>
    apiClient
      .get<DailyBackupSeries>("/jobs/analytics/daily", {
        params: { window, ...(connectionId ? { connectionId } : {}) },
      })
      .then((r) => r.data),

  getStorageByConnection: () =>
    apiClient
      .get<ConnectionStorage[]>("/jobs/analytics/storage-by-connection")
      .then((r) => r.data),

  getConnectionsHealth: (window: AnalyticsWindow = 30) =>
    apiClient
      .get<ConnectionsHealth>("/jobs/analytics/connections-health", {
        params: { window },
      })
      .then((r) => r.data),
};
