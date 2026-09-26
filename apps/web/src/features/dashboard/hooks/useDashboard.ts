import { useQueries } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";

export function useDashboard() {
  const results = useQueries({
    queries: [
      {
        queryKey: ["dashboard", "recent-backups"],
        queryFn: () => dashboardApi.getRecentBackups(15),
        refetchInterval: 15_000,
      },
      {
        queryKey: ["dashboard", "recent-restores"],
        queryFn: () => dashboardApi.getRecentRestores(5),
        refetchInterval: 15_000,
      },
    ],
  });

  return {
    recentBackups: Array.isArray(results[0].data) ? results[0].data : [],
    recentRestores: Array.isArray(results[1].data) ? results[1].data : [],
    isLoading: results.some((r) => r.isLoading),
    errors: results.map((r) => r.error).filter(Boolean),
    // dashboard-charts-web: feeds the header's freshness timestamp (max
    // dataUpdatedAt across mounted queries).
    dataUpdatedAt: Math.max(...results.map((r) => r.dataUpdatedAt)),
  };
}
