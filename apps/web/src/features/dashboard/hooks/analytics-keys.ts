import type { AnalyticsWindow } from "../types";

// dashboard-charts-web: single builder so every analytics hook and any manual
// invalidation (queryClient.invalidateQueries) agree on key shape.
export const dashboardAnalyticsKeys = {
  all: ["dashboard", "analytics"] as const,
  daily: (window: AnalyticsWindow) =>
    [...dashboardAnalyticsKeys.all, "daily", window] as const,
  storageByConnection: () =>
    [...dashboardAnalyticsKeys.all, "storage-by-connection"] as const,
  restoreStatus: () =>
    [...dashboardAnalyticsKeys.all, "restore-status"] as const,
};
