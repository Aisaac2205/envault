import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDailyAnalytics } from "../useDailyAnalytics";
import type { DailyBackupSeries } from "../../types";
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

const series: DailyBackupSeries = {
  window: 30,
  from: "2026-08-01",
  to: "2026-08-30",
  timezone: "UTC",
  days: [
    {
      date: "2026-08-30",
      completed: 3,
      failed: 1,
      p50DurationSeconds: 12,
      p95DurationSeconds: 20,
      totalSizeMb: 42,
    },
  ],
};

describe("useDailyAnalytics", () => {
  beforeEach(() => {
    mockApiClient.get.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not call the API and stays disabled for non-admin sessions", async () => {
    mockAuth("user");
    const { result } = renderHook(() => useDailyAnalytics(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("fetches window=30 by default for admin sessions", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValueOnce({ data: series });

    const { result } = renderHook(() => useDailyAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiClient.get).toHaveBeenCalledWith("/jobs/analytics/daily", {
      params: { window: 30 },
    });
    expect(result.current.data).toEqual(series);
  });

  it("re-scopes to the new window and keeps previous data while refetching", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValueOnce({ data: series });

    const { result, rerender } = renderHook(
      ({ window }: { window: 7 | 30 | 90 }) => useDailyAnalytics(window),
      { wrapper: createWrapper(), initialProps: { window: 30 } },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    let resolveNext!: (value: { data: DailyBackupSeries }) => void;
    mockApiClient.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
    );

    rerender({ window: 7 });

    await waitFor(() =>
      expect(mockApiClient.get).toHaveBeenLastCalledWith(
        "/jobs/analytics/daily",
        { params: { window: 7 } },
      ),
    );
    // keepPreviousData: stale data from window=30 stays visible while window=7 loads.
    expect(result.current.data).toEqual(series);
    expect(result.current.isPlaceholderData).toBe(true);

    await act(async () => {
      resolveNext({ data: { ...series, window: 7 } });
    });

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
  });

  it("refetches every 30 seconds", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValue({ data: series });

    renderHook(() => useDailyAnalytics(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockApiClient.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mockApiClient.get).toHaveBeenCalledTimes(2);
  });
});
