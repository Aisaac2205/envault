import apiClient from "@/shared/lib/api-client";
import type { Connection, RestoreDto, RestoreExecuteResult, RestoreJob } from "../types";

export const restoreApi = {
  getConnections: () =>
    apiClient.get<Connection[]>("/connections").then((r) => r.data),

  getRestoreHistory: () =>
    apiClient.get<RestoreJob[]>("/restores").then((r) => r.data),

  executeDryRun: (dto: RestoreDto) =>
    apiClient
      .post<RestoreExecuteResult>("/restores", { ...dto, isDryRun: true })
      .then((r) => r.data),

  executeRestore: (dto: RestoreDto) =>
    apiClient
      .post<RestoreExecuteResult>("/restores", { ...dto, isDryRun: false })
      .then((r) => r.data),

  cancelRestore: (id: string) =>
    apiClient
      .post<{ message: string; jobId?: string }>(`/restores/${id}/cancel`)
      .then((r) => r.data),
};
