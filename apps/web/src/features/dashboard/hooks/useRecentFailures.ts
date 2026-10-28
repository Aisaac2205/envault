import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";

/** How many failures the card lists: a glance, the Dumps page has the rest. */
export const RECENT_FAILURES_LIMIT = 5;

/** The latest failed backups, polled as often as the rest of the dashboard. */
export function useRecentFailures() {
  return useQuery({
    queryKey: ["dashboard", "recent-failures"],
    queryFn: async () => {
      const response = await dashboardApi.getRecentFailures(RECENT_FAILURES_LIMIT);
      return Array.isArray(response) ? response : [];
    },
    refetchInterval: 15_000,
  });
}
