import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks/useAuth";
import { dashboardApi } from "../api/dashboard-api";

/** Feeds the Storage section's live R2 figure. Disabled entirely (no network call) for non-admins, matching the rest of this admin-only page. */
export function useStorageStats() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return useQuery({
    queryKey: ["dashboard", "storage"],
    queryFn: async () => {
      const response = await dashboardApi.getDumpsFromR2();
      return Array.isArray(response) ? response : [];
    },
    enabled: isAdmin,
    refetchInterval: 60_000,
  });
}
