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
  const [backupsResult, restoresResult] = results;

  return {
    recentBackups: Array.isArray(backupsResult.data) ? backupsResult.data : [],
    recentRestores: Array.isArray(restoresResult.data) ? restoresResult.data : [],
    isLoading: results.some((r) => r.isLoading),
    errors: results.map((r) => r.error).filter(Boolean),
    // dashboard-charts-web: feeds the header's freshness timestamp (max
    // dataUpdatedAt across mounted queries).
    dataUpdatedAt: Math.max(...results.map((r) => r.dataUpdatedAt)),
    // dashboard-charts-web (S7): per-query status so the page-shell "Activity"
    // group (backups) and "Restores" group can fail/retry independently
    // instead of the combined `errors`/`isLoading` above coupling them.
    backups: {
      isLoading: backupsResult.isLoading,
      isError: backupsResult.isError,
      refetch: backupsResult.refetch,
    },
    restores: {
      isLoading: restoresResult.isLoading,
      isError: restoresResult.isError,
      refetch: restoresResult.refetch,
    },
  };
}
