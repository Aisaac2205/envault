import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dashboardApi } from "../../api/dashboard-api";
import type { BackupJob } from "../../types";
import { RECENT_FAILURES_LIMIT, useRecentFailures } from "../useRecentFailures";

vi.mock("../../api/dashboard-api", () => ({
  dashboardApi: { getRecentFailures: vi.fn() },
}));

const getRecentFailures = vi.mocked(dashboardApi.getRecentFailures);

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderFailures() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useRecentFailures(), { wrapper });
}

const failed: BackupJob = {
  id: "backup-1",
  connectionId: "conn-shop",
  connectionName: "Shop",
  environment: "production",
  status: "failed",
  fileKey: null,
  fileSizeMb: null,
  startedAt: "2026-10-28T02:00:00Z",
  completedAt: null,
  errorMessage: "pg_dump: error: connection refused",
  triggeredBy: "cron",
  createdAt: "2026-10-28T02:00:00Z",
};

describe("useRecentFailures", () => {
  afterEach(() => {
    vi.clearAllMocks();
    client.clear();
  });

  it("asks for the five latest failed backups", async () => {
    getRecentFailures.mockResolvedValue([failed]);

    const { result } = renderFailures();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(RECENT_FAILURES_LIMIT).toBe(5);
    expect(getRecentFailures).toHaveBeenCalledWith(5);
    expect(result.current.data).toEqual([failed]);
  });

  it("polls as often as the rest of the dashboard, under the dashboard keys", async () => {
    getRecentFailures.mockResolvedValue([]);

    const { result } = renderFailures();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: ["dashboard", "recent-failures"] });
    expect(query).toBeDefined();
    expect((query?.options as { refetchInterval?: unknown }).refetchInterval).toBe(15_000);
  });

  it.each([
    ["an object", { unexpected: true }],
    ["null", null],
  ])("reads %s as no failures instead of failing", async (_name, body) => {
    getRecentFailures.mockResolvedValue(body as unknown as BackupJob[]);

    const { result } = renderFailures();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
