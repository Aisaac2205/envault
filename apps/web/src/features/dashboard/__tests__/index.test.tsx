import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { mockChartSize } from "@/test/chart-env";
import Dashboard from "../index";
import { dashboardApi } from "../api/dashboard-api";
import { useAuth } from "@/shared/hooks/useAuth";
import type {
  BackupJob,
  RestoreJob,
  ConnectionEntity,
  CronjobEntity,
  DashboardStats,
  DailyBackupCount,
  R2Object,
  DailyBackupSeries,
  ConnectionStorage,
  RestoreStatusCounts,
} from "../types";

vi.mock("../api/dashboard-api");
vi.mock("@/shared/hooks/useAuth");

const mockApi = vi.mocked(dashboardApi);
const mockUseAuth = vi.mocked(useAuth);

function mockAuth(role: string | null) {
  mockUseAuth.mockReturnValue({
    user: role ? { id: "u1", email: "u@test.com", name: "U", role } : null,
    isAuthenticated: !!role,
    isInitializing: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

const backups: BackupJob[] = [
  {
    id: "b1",
    connectionId: "c1",
    connectionName: "prod-db",
    environment: "production",
    status: "completed",
    fileKey: "k",
    fileSizeMb: 12,
    startedAt: null,
    completedAt: "2026-09-01T00:00:00Z",
    errorMessage: null,
    triggeredBy: "cron",
    createdAt: "2026-09-01T00:00:00Z",
  },
];
const restores: RestoreJob[] = [
  { id: "r1", targetConnectionId: "c1", targetEnvironment: "production", isDryRun: false, status: "completed", createdAt: "2026-09-01T00:00:00Z" },
];
const connections: ConnectionEntity[] = [{ id: "c1", name: "prod-db", dbType: "postgres", environment: "production", isActive: true }];
const cronjobs: CronjobEntity[] = [
  { id: "cj1", name: "nightly", isActive: true, cronExpression: "0 0 * * *", connectionId: "c1", connectionName: "prod-db", nextRunAt: "2026-09-02T00:00:00Z", lastRunAt: null, lastStatus: null },
];
const stats: DashboardStats = { successRate30d: 98.4, backupsToday: 2, failed7d: 0, totalStorageMb: 1200 };
const dailyCounts: DailyBackupCount[] = [{ date: "2026-09-01", scheduled: 3, manual: 1 }];
const dumps: R2Object[] = [{ key: "k1", size: 100, lastModified: "2026-09-01T00:00:00Z", etag: "e1" }];
const series: DailyBackupSeries = {
  window: 30,
  from: "2026-08-01",
  to: "2026-09-01",
  timezone: "UTC",
  days: [{ date: "2026-09-01", completed: 4, failed: 1, p50DurationSeconds: 10, p95DurationSeconds: 20, totalSizeMb: 100 }],
};
const storageRows: ConnectionStorage[] = [{ connectionId: "c1", connectionName: "prod-db", totalSizeMb: 4100, backupCount: 12 }];
const restoreCounts: RestoreStatusCounts = { pending: 1, running: 0, completed: 10, failed: 1, total: 12 };

function mockAllSuccess() {
  mockApi.getRecentBackups.mockResolvedValue(backups);
  mockApi.getRecentRestores.mockResolvedValue(restores);
  mockApi.getConnections.mockResolvedValue(connections);
  mockApi.getCronjobs.mockResolvedValue(cronjobs);
  mockApi.getStats.mockResolvedValue(stats);
  mockApi.getDailyCounts.mockResolvedValue(dailyCounts);
  mockApi.getDumpsFromR2.mockResolvedValue(dumps);
  mockApi.getDailyAnalytics.mockResolvedValue(series);
  mockApi.getStorageByConnection.mockResolvedValue(storageRows);
  mockApi.getRestoreStatusCounts.mockResolvedValue(restoreCounts);
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Dashboard page (S7 composition)", () => {
  beforeEach(() => {
    mockChartSize(320, 112);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a restricted-access notice and fires zero admin-only requests for non-admins", () => {
    mockAuth("user");
    mockAllSuccess();

    renderDashboard();

    expect(screen.getByText("El monitoreo está disponible para administradores")).toBeInTheDocument();
    expect(mockApi.getRecentBackups).not.toHaveBeenCalled();
    expect(mockApi.getRecentRestores).not.toHaveBeenCalled();
    expect(mockApi.getConnections).not.toHaveBeenCalled();
    expect(mockApi.getCronjobs).not.toHaveBeenCalled();
    expect(mockApi.getDailyAnalytics).not.toHaveBeenCalled();
    expect(mockApi.getStorageByConnection).not.toHaveBeenCalled();
    expect(mockApi.getRestoreStatusCounts).not.toHaveBeenCalled();
  });

  it("renders the full page for admins once data loads", async () => {
    mockAuth("admin");
    mockAllSuccess();

    renderDashboard();

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(screen.queryByText("El monitoreo está disponible para administradores")).not.toBeInTheDocument();
  });

  it("keeps other sections rendering normally when the Restores query fails", async () => {
    mockAuth("admin");
    mockAllSuccess();
    mockApi.getRestoreStatusCounts.mockRejectedValue(new Error("boom"));

    renderDashboard();

    // Trends (a different independent group) still renders its data table.
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    // Restores shows its own inline error + retry without hiding the rest of the page.
    const retryButtons = await screen.findAllByRole("button", { name: /reintentar/i });
    expect(retryButtons.length).toBeGreaterThan(0);
  });

  it("shows nothing admin-restricted while auth is still initializing", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isInitializing: true,
      login: vi.fn(),
      logout: vi.fn(),
    });
    mockAllSuccess();

    renderDashboard();

    expect(screen.queryByText("El monitoreo está disponible para administradores")).not.toBeInTheDocument();
    expect(mockApi.getRecentBackups).not.toHaveBeenCalled();
  });
});
