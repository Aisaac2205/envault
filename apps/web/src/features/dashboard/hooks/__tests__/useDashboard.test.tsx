import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDashboard } from "../useDashboard";
import type { BackupJob, RestoreJob } from "../../types";
import { dashboardApi } from "../../api/dashboard-api";
import { useAuth } from "../../../../shared/hooks/useAuth";

vi.mock("../../api/dashboard-api");
vi.mock("../../../../shared/hooks/useAuth");

const mockDashboardApi = vi.mocked(dashboardApi);
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
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
  {
    id: "r1",
    targetConnectionId: "c1",
    targetEnvironment: "production",
    isDryRun: false,
    status: "completed",
    createdAt: "2026-09-01T00:00:00Z",
  },
];

describe("useDashboard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockAuth("admin");
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not call /jobs/backups or /jobs/restores for non-admin sessions (Restricted Access requirement)", () => {
    mockAuth("user");

    const { result } = renderHook(() => useDashboard(), { wrapper: createWrapper() });

    expect(mockDashboardApi.getRecentBackups).not.toHaveBeenCalled();
    expect(mockDashboardApi.getRecentRestores).not.toHaveBeenCalled();
    expect(result.current.backups.isLoading).toBe(false);
    expect(result.current.restores.isLoading).toBe(false);
  });

  it("exposes per-query status so a restores failure does not mark backups as failed", async () => {
    mockDashboardApi.getRecentBackups.mockResolvedValue(backups);
    mockDashboardApi.getRecentRestores.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.backups.isLoading).toBe(false));
    await waitFor(() => expect(result.current.restores.isError).toBe(true));

    expect(result.current.backups.isError).toBe(false);
    expect(result.current.recentBackups).toEqual(backups);
    expect(result.current.restores.isError).toBe(true);
    expect(result.current.recentRestores).toEqual([]);
  });

  it("exposes refetch functions per query", async () => {
    mockDashboardApi.getRecentBackups.mockResolvedValue(backups);
    mockDashboardApi.getRecentRestores.mockResolvedValue(restores);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.backups.isLoading).toBe(false));

    expect(typeof result.current.backups.refetch).toBe("function");
    expect(typeof result.current.restores.refetch).toBe("function");
  });

  it("still exposes the combined isLoading/errors/dataUpdatedAt fields", async () => {
    mockDashboardApi.getRecentBackups.mockResolvedValue(backups);
    mockDashboardApi.getRecentRestores.mockResolvedValue(restores);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.errors).toEqual([]);
    expect(result.current.dataUpdatedAt).toEqual(expect.any(Number));
  });
});
