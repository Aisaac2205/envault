import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dashboardApi } from "../../api/dashboard-api";
import type { ConnectionStorage } from "../../types";
import { useStorageByConnection } from "../useStorageByConnection";

vi.mock("../../api/dashboard-api", () => ({
  dashboardApi: { getStorageByConnection: vi.fn() },
}));

const getStorageByConnection = vi.mocked(dashboardApi.getStorageByConnection);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const shop: ConnectionStorage = {
  connectionId: "conn-shop",
  connectionName: "Shop",
  totalSizeMb: 1536,
  backupCount: 12,
};

describe("useStorageByConnection", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the connections as the API sent them", async () => {
    getStorageByConnection.mockResolvedValue([shop]);

    const { result } = renderHook(() => useStorageByConnection(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([shop]);
  });

  // The dashboard hooks share this convention (6 call sites): a body that is not
  // an array is read as "no data", so the card shows its empty state, not an error.
  // This pins it, so nobody removes the guard and meets a `.map` crash instead.
  it.each([
    ["an object", { unexpected: true }],
    ["null", null],
    ["a string", "Bad Gateway"],
  ])("reads %s as an empty list instead of failing", async (_name, body) => {
    getStorageByConnection.mockResolvedValue(body as unknown as ConnectionStorage[]);

    const { result } = renderHook(() => useStorageByConnection(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it("still reports a request that fails", async () => {
    getStorageByConnection.mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => useStorageByConnection(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Network Error");
  });
});
