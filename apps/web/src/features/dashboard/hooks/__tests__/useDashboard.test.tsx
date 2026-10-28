import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dashboardApi } from "../../api/dashboard-api";
import type { RestoreJob } from "../../types";
import { useDashboard } from "../useDashboard";

vi.mock("../../api/dashboard-api", () => ({
  dashboardApi: { getRecentRestores: vi.fn() },
}));

const getRecentRestores = vi.mocked(dashboardApi.getRecentRestores);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const restore: RestoreJob = {
  id: "restore-1",
  targetConnectionId: "conn-dev",
  targetEnvironment: "development",
  isDryRun: false,
  status: "completed",
  createdAt: "2026-10-27T23:46:06.323Z",
};

describe("useDashboard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the five latest restores and returns them", async () => {
    getRecentRestores.mockResolvedValue([restore]);

    const { result } = renderHook(() => useDashboard(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getRecentRestores).toHaveBeenCalledWith(5);
    expect(result.current.recentRestores).toEqual([restore]);
    expect(result.current.errors).toEqual([]);
  });

  it("returns an empty list when the answer is not a list", async () => {
    getRecentRestores.mockResolvedValue({} as unknown as RestoreJob[]);

    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.recentRestores).toEqual([]);
  });

  it("reports the error when the restores request fails", async () => {
    const failure = new Error("network down");
    getRecentRestores.mockRejectedValue(failure);

    const { result } = renderHook(() => useDashboard(), { wrapper });

    await waitFor(() => expect(result.current.errors).toEqual([failure]));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.recentRestores).toEqual([]);
  });
});
