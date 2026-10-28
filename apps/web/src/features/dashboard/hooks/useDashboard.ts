import { useQueries } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";

/** The lists the dashboard page reads itself; each card fetches the rest. */
export function useDashboard() {
  const results = useQueries({
    queries: [
      {
        queryKey: ["dashboard", "recent-restores"],
        queryFn: () => dashboardApi.getRecentRestores(5),
        refetchInterval: 15_000,
      },
    ],
  });

  return {
    recentRestores: Array.isArray(results[0].data) ? results[0].data : [],
    isLoading: results.some((r) => r.isLoading),
    errors: results.map((r) => r.error).filter(Boolean),
  };
}
