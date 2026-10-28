import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";
import type { AnalyticsWindow } from "../types";

/** Per connection backup health (freshness, last backup, schedule, window statistics). */
export function useConnectionsHealth(window: AnalyticsWindow) {
  return useQuery({
    queryKey: ["dashboard", "analytics", "connections-health", window],
    queryFn: () => dashboardApi.getConnectionsHealth(window),
    refetchInterval: 30_000,
  });
}
