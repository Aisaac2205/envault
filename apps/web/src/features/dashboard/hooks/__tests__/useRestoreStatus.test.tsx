import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRestoreStatus } from "../useRestoreStatus";
import type { RestoreStatusCounts } from "../../types";
import apiClient from "../../../../shared/lib/api-client";
import { useAuth } from "../../../../shared/hooks/useAuth";

vi.mock("../../../../shared/lib/api-client");
vi.mock("../../../../shared/hooks/useAuth");

const mockApiClient = vi.mocked(apiClient);
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

const counts: RestoreStatusCounts = {
  pending: 1,
  running: 1,
  completed: 40,
  failed: 2,
  total: 44,
};

describe("useRestoreStatus", () => {
  beforeEach(() => {
    mockApiClient.get.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not call the API for non-admin sessions", () => {
    mockAuth("user");
    const { result } = renderHook(() => useRestoreStatus(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("fetches restore-status for admin sessions", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValueOnce({ data: counts });

    const { result } = renderHook(() => useRestoreStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/jobs/analytics/restore-status",
    );
    expect(result.current.data).toEqual(counts);
  });

  it("refetches every 30 seconds", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValue({ data: counts });

    renderHook(() => useRestoreStatus(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockApiClient.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mockApiClient.get).toHaveBeenCalledTimes(2);
  });
});
