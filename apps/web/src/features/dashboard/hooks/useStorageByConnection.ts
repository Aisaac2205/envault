import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard-api";

export function useStorageByConnection() {
  return useQuery({
    queryKey: ["dashboard", "analytics", "storage-by-connection"],
    queryFn: async () => {
      const response = await dashboardApi.getStorageByConnection();
      return Array.isArray(response) ? response : [];
    },
    refetchInterval: 30_000,
  });
}
