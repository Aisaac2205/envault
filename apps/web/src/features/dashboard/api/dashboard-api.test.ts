import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/shared/lib/api-client";
import { dashboardApi } from "./dashboard-api";

vi.mock("@/shared/lib/api-client");

const mockApiClient = vi.mocked(apiClient);

// Routes the API serves under its `/api` prefix and the dashboard reads. Adding
// a call to the client means adding its route here, which is the moment to
// check that the API really serves it.
const SERVED_ENDPOINTS = [
  "/jobs/summary",
  "/jobs/backups",
  "/jobs/restores",
  "/jobs/stats",
  "/jobs/daily-counts",
  "/connections",
  "/cronjobs",
  "/audit",
  "/backups/r2",
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

    expect(paths.filter((path) => /health/i.test(path))).toEqual([]);
  });
});
