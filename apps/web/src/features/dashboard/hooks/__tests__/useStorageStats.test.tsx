import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useStorageStats } from "../useStorageStats";
import type { R2Object } from "../../types";
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const dumps: R2Object[] = [{ key: "k1", size: 100, lastModified: "2026-09-01T00:00:00Z", etag: "e1" }];

describe("useStorageStats", () => {
  beforeEach(() => {
    mockApiClient.get.mockClear();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not call /backups/r2 for non-admin sessions (Restricted Access requirement)", () => {
    mockAuth("user");
    const { result } = renderHook(() => useStorageStats(), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("fetches /backups/r2 for admin sessions", async () => {
    mockAuth("admin");
    mockApiClient.get.mockResolvedValueOnce({ data: dumps });

    const { result } = renderHook(() => useStorageStats(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/backups/r2");
    expect(result.current.data).toEqual(dumps);
  });
});
