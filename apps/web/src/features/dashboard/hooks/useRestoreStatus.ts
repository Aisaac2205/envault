import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks/useAuth";
import { dashboardApi } from "../api/dashboard-api";
import { dashboardAnalyticsKeys } from "./analytics-keys";

const ANALYTICS_REFETCH_MS = 30_000;

/**
 * Distribution section (all-time, no window). Admin-only: disabled entirely
 * (no network call) for non-admin sessions.
 */
export function useRestoreStatus() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return useQuery({
    queryKey: dashboardAnalyticsKeys.restoreStatus(),
    queryFn: () => dashboardApi.getRestoreStatusCounts(),
    enabled: isAdmin,
    placeholderData: keepPreviousData,
    refetchInterval: ANALYTICS_REFETCH_MS,
  });
}
