import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dashboardApi } from "../../api/dashboard-api";
import type { ConnectionsHealth } from "../../types";
import { useConnectionsHealth } from "../useConnectionsHealth";

vi.mock("../../api/dashboard-api", () => ({
  dashboardApi: { getConnectionsHealth: vi.fn() },
}));

const getConnectionsHealth = vi.mocked(dashboardApi.getConnectionsHealth);

const health: ConnectionsHealth = {
  window: 30,
  from: "2026-09-28",
  to: "2026-10-27",
  timezone: "UTC",
  overall: {
    completed: 10,
    failed: 2,
    successRate: 0.8333,
    p50DurationSeconds: 4,
    p95DurationSeconds: 9,
  },
  connections: [],
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe("useConnectionsHealth", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks the API for the window and returns the answer as it came", async () => {
    getConnectionsHealth.mockResolvedValue(health);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useConnectionsHealth(7), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getConnectionsHealth).toHaveBeenCalledWith(7);
    expect(result.current.data).toBe(health);
  });

  it("caches each window under its own key, so the KPIs and the table share the 30 day answer", async () => {
    getConnectionsHealth.mockResolvedValue(health);
    const { client, wrapper } = makeWrapper();

    const { result } = renderHook(() => useConnectionsHealth(30), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      client.getQueryData(["dashboard", "analytics", "connections-health", 30]),
    ).toBe(health);
    expect(
      client.getQueryData(["dashboard", "analytics", "connections-health", 7]),
    ).toBeUndefined();
  });

  it("reports a request that fails", async () => {
    getConnectionsHealth.mockRejectedValue(new Error("Network Error"));
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useConnectionsHealth(30), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Network Error");
  });
});
