import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import apiClient from "@/shared/lib/api-client";
import { useDeleteConnection } from "../hooks/useConnections";

vi.mock("@/shared/lib/api-client", () => ({
  default: { delete: vi.fn() },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useDeleteConnection", () => {
  beforeEach(() => {
    vi.mocked(apiClient.delete).mockReset();
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined });
  });

  it("sends the step-up confirmation in the request body", async () => {
    const { result } = renderHook(() => useDeleteConnection(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "conn-1",
      confirmation: { confirmName: "Orders DB", password: "s3cret" },
    });

    expect(apiClient.delete).toHaveBeenCalledWith("/connections/conn-1", {
      data: { confirmName: "Orders DB", password: "s3cret" },
    });
  });

  it("sends no body when there is no confirmation", async () => {
    const { result } = renderHook(() => useDeleteConnection(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({ id: "conn-2" });

    expect(apiClient.delete).toHaveBeenCalledWith("/connections/conn-2", undefined);
  });
});
