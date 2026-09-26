import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useStorageByConnection } from "../useStorageByConnection";
import type { ConnectionStorage } from "../../types";
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

const rows: ConnectionStorage[] = [
  { connectionId: "c1", connectionName: "prod-db", totalSizeMb: 12400, backupCount: 40 },
  { connectionId: "c2", connectionName: null, totalSizeMb: 900, backupCount: 3 },
];

describe("useStorageByConnection", () => {
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
    const { result } = renderHook(() => useStorageByConnection(), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("fetches storage-by-connection for admin sessions", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValueOnce({ data: rows });

    const { result } = renderHook(() => useStorageByConnection(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/jobs/analytics/storage-by-connection",
    );
    expect(result.current.data).toEqual(rows);
  });

  it("refetches every 30 seconds", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValue({ data: rows });

    renderHook(() => useStorageByConnection(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockApiClient.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mockApiClient.get).toHaveBeenCalledTimes(2);
  });
});
