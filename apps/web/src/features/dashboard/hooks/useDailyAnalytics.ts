import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks/useAuth";
import { dashboardApi } from "../api/dashboard-api";
import { dashboardAnalyticsKeys } from "./analytics-keys";
import type { AnalyticsWindow } from "../types";

const ANALYTICS_REFETCH_MS = 30_000;

/**
 * Shared endpoint for the Trends section (Outcome/Duration/Size charts).
 * Admin-only: disabled entirely (no network call) for non-admin sessions.
 */
export function useDailyAnalytics(window: AnalyticsWindow = 30) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return useQuery({
    queryKey: dashboardAnalyticsKeys.daily(window),
    queryFn: () => dashboardApi.getDailyAnalytics(window),
    enabled: isAdmin,
    placeholderData: keepPreviousData,
    refetchInterval: ANALYTICS_REFETCH_MS,
  });
}
