import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";
import type { AnalyticsWindow } from "../types";

/** Zero-filled daily backup series, optionally scoped to one connection. */
export function useDailyAnalytics(window: AnalyticsWindow, connectionId?: string) {
  return useQuery({
    queryKey: ["dashboard", "analytics", "daily", window, connectionId ?? null],
    queryFn: () => dashboardApi.getDailyAnalytics(window, connectionId),
    refetchInterval: 30_000,
  });
}
