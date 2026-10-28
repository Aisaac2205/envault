import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";

export function useRestoreStatus() {
  return useQuery({
    queryKey: ["dashboard", "analytics", "restore-status"],
    queryFn: dashboardApi.getRestoreStatus,
    refetchInterval: 30_000,
  });
}
