import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/shared/lib/api-client";
import { dashboardApi } from "./dashboard-api";

vi.mock("@/shared/lib/api-client");

const mockApiClient = vi.mocked(apiClient);

// Routes the API serves under its `/api` prefix and the dashboard reads. Adding
// a call to the client means adding its route here, which is the moment to
// check that the API really serves it.
const SERVED_ENDPOINTS = [
  "/jobs/backups",
  "/jobs/restores",
  "/jobs/analytics/daily",
  "/jobs/analytics/storage-by-connection",
  "/jobs/analytics/connections-health",
  "/connections",
];

// Calls every function of the client and returns the path each one requested.
async function requestedPaths(): Promise<string[]> {
  mockApiClient.get.mockResolvedValue({ data: [] });
  for (const call of Object.values(dashboardApi)) {
    await call();
  }
  return mockApiClient.get.mock.calls.map(([path]) => path);
}

describe("dashboardApi", () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
  });

  it("only requests endpoints that the API serves under its /api prefix", async () => {
    const paths = await requestedPaths();

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(SERVED_ENDPOINTS, `unexpected endpoint ${path}`).toContain(path);
    }
  });

  it("never requests a health endpoint, which the API keeps internal at /health outside the /api prefix", async () => {
    const paths = await requestedPaths();

    // Only the service health route: `/jobs/analytics/connections-health` is a dashboard route.
    expect(paths.filter((path) => /^\/(api\/)?health(\/|$)/i.test(path))).toEqual([]);
  });

  describe("recent failures", () => {
    it("getRecentFailures asks the backups list for the five latest failed ones", async () => {
      const jobs = [{ id: "backup-1", status: "failed" }];
      mockApiClient.get.mockResolvedValue({ data: jobs });

      const result = await dashboardApi.getRecentFailures();

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/backups", {
        params: { status: "failed", limit: 5 },
      });
      expect(result).toBe(jobs);
    });

    it("getRecentFailures passes a different limit through", async () => {
      mockApiClient.get.mockResolvedValue({ data: [] });

      await dashboardApi.getRecentFailures(3);

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/backups", {
        params: { status: "failed", limit: 3 },
      });
    });

    it("no longer reads the unfiltered backups list", () => {
      expect(dashboardApi).not.toHaveProperty("getRecentBackups");
    });
  });

  describe("analytics", () => {
    const CONNECTION_ID = "6c1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

    it("getDailyAnalytics requests the daily series with the window and connection filter", async () => {
      const series = { window: 90, days: [] };
      mockApiClient.get.mockResolvedValue({ data: series });

      const result = await dashboardApi.getDailyAnalytics(90, CONNECTION_ID);

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/analytics/daily", {
        params: { window: 90, connectionId: CONNECTION_ID },
      });
      expect(result).toBe(series);
    });

    it("getDailyAnalytics does not send connectionId when it is undefined", async () => {
      mockApiClient.get.mockResolvedValue({ data: { days: [] } });

      await dashboardApi.getDailyAnalytics(7);

      const [, config] = mockApiClient.get.mock.calls[0];
      expect(config?.params).toEqual({ window: 7 });
      expect(config?.params).not.toHaveProperty("connectionId");
    });

    it("getDailyAnalytics defaults to the 30 day window", async () => {
      mockApiClient.get.mockResolvedValue({ data: { days: [] } });

      await dashboardApi.getDailyAnalytics();

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/analytics/daily", {
        params: { window: 30 },
      });
    });

    it("getStorageByConnection requests the per-connection storage totals", async () => {
      const rows = [
        { connectionId: CONNECTION_ID, connectionName: "prod", totalSizeMb: 12.5, backupCount: 3 },
      ];
      mockApiClient.get.mockResolvedValue({ data: rows });

      const result = await dashboardApi.getStorageByConnection();

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/analytics/storage-by-connection");
      expect(result).toBe(rows);
    });

    it("getConnectionsHealth requests the health of each connection over the window", async () => {
      const health = { window: 7, connections: [] };
      mockApiClient.get.mockResolvedValue({ data: health });

      const result = await dashboardApi.getConnectionsHealth(7);

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/analytics/connections-health", {
        params: { window: 7 },
      });
      expect(result).toBe(health);
    });

    it("getConnectionsHealth defaults to the 30 day window", async () => {
      mockApiClient.get.mockResolvedValue({ data: { connections: [] } });

      await dashboardApi.getConnectionsHealth();

      expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/analytics/connections-health", {
        params: { window: 30 },
      });
    });
  });
});
