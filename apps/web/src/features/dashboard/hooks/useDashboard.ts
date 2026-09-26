import { useQueries } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks/useAuth";
import { dashboardApi } from "../api/dashboard-api";

/** `/jobs/backups` and `/jobs/restores` are admin-only server-side; both queries are disabled entirely (no network call) for non-admins (Restricted Access requirement). */
export function useDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const results = useQueries({
    queries: [
      {
        queryKey: ["dashboard", "recent-backups"],
        queryFn: () => dashboardApi.getRecentBackups(15),
        enabled: isAdmin,
        refetchInterval: 15_000,
      },
      {
        queryKey: ["dashboard", "recent-restores"],
        queryFn: () => dashboardApi.getRecentRestores(5),
        enabled: isAdmin,
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
