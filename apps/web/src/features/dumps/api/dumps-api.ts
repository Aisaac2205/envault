import apiClient from "@/shared/lib/api-client";
import type { BackupJob, Connection, EnrichedR2Object, PaginatedDumps, DumpsFilters } from "../types";
import type { BackupCategory } from "@/types/backup.types";

export interface GetHistoryParams {
  page?: number;
  pageSize?: number;
  filters?: DumpsFilters;
}

export const dumpsApi = {
  getHistory: (params?: GetHistoryParams) =>
    apiClient
      .get<PaginatedDumps>("/backups/history", {
        params: {
          page: params?.page ?? 1,
          pageSize: params?.pageSize ?? 25,
          ...params?.filters,
        },
      })
      .then((r) => r.data),

  getBackupById: (id: string) =>
    apiClient.get<BackupJob>(`/backups/${id}`).then((r) => r.data),

  getEnrichedR2Dumps: (params: {
    connectionSlug: string;
    category: BackupCategory;
  }) =>
    apiClient
      .get<EnrichedR2Object[]>("/backups/r2/enriched", { params })
      .then((r) => r.data),

  getConnections: () =>
    apiClient.get<Connection[]>("/connections").then((r) => r.data),

  triggerBackup: (connectionId: string) =>
    apiClient.post(`/backups/trigger/${connectionId}`),

  getDownloadUrl: (id: string) =>
    apiClient
      .post<{ url: string; fileKey: string }>(`/backups/${id}/download-url`)
      .then((r) => r.data),

  cancelBackup: (id: string) =>
    apiClient
      .post<{ message: string; jobId?: string }>(`/backups/${id}/cancel`)
      .then((r) => r.data),
};
