import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import apiClient from "../../../shared/lib/api-client";
import type {
  Connection,
  CreateConnectionDto,
  UpdateConnectionDto,
  ConnectionTestResult,
  DeleteConnectionVariables,
  TestRawConnectionDto,
} from "../types";

// ─── Queries ───────────────────────────────────────────────

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
    queryFn: async () => {
      const response = await apiClient.get<Connection[]>("/connections");
      return Array.isArray(response.data) ? response.data : [];
    },
    refetchInterval: 30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────

export function useCreateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dto: CreateConnectionDto) => {
      const response = await apiClient.post<Connection>("/connections", dto);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      dto,
    }: {
      id: string;
      dto: UpdateConnectionDto;
    }) => {
      const response = await apiClient.patch<Connection>(
        `/connections/${id}`,
        dto,
      );
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, confirmation }: DeleteConnectionVariables) => {
      await apiClient.delete(
        `/connections/${id}`,
        confirmation ? { data: confirmation } : undefined,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ConnectionTestResult>(
        `/connections/${id}/test`,
      );
      return response.data;
    },
  });
}

export function useTestRawConnection() {
  return useMutation({
    mutationFn: async (dto: TestRawConnectionDto) => {
      const response = await apiClient.post<ConnectionTestResult>(
        "/connections/test-raw",
        dto,
      );
      return response.data;
    },
  });
}
