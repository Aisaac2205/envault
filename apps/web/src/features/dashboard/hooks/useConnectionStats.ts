import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks/useAuth";
import { dashboardApi } from "../api/dashboard-api";

/** `/connections` is admin-only server-side; disabled entirely (no network call) for non-admins (Restricted Access requirement). */
export function useConnectionStats() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return useQuery({
    queryKey: ["dashboard", "connections"],
    queryFn: async () => {
      const response = await dashboardApi.getConnections();
      return Array.isArray(response) ? response : [];
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });
}
