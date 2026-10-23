import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter } from "react-router-dom";
import apiClient from "@/shared/lib/api-client";
import { authClient } from "@/shared/lib/auth-client";
import { PERMISSIONS_QUERY_KEY } from "@/shared/lib/permissions-query-key";
import { APP_SECTIONS } from "@/shared/lib/sections";
import { usePermissions } from "../usePermissions";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { useSession: vi.fn() },
}));
vi.mock("@/shared/lib/api-client", () => ({
  default: { get: vi.fn() },
}));

function signInAs(role: string | null, id = "u1", sessionId = "s1") {
  vi.mocked(authClient.useSession).mockReturnValue({
    data: role
      ? {
          user: { id, email: "ana@envault.local", name: "Ana", role },
          session: { id: sessionId },
        }
      : null,
    isPending: false,
  } as unknown as ReturnType<typeof authClient.useSession>);
}

function serverGrants(role: string, features: string[]) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { role, features } });
}

function renderPermissions() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...renderHook(() => usePermissions(), { wrapper }) };
}

function httpError(status: number) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
  } as AxiosResponse);
}

const ALL_FEATURES = APP_SECTIONS.map((section) => section.feature);

describe("usePermissions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("asks the API for the signed-in user's permissions", async () => {
    signInAs("admin");
    serverGrants("admin", ALL_FEATURES);

    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(apiClient.get).toHaveBeenCalledWith("/me/permissions");
  });

  it("reports loading, and offers nothing, until the answer arrives", async () => {
    signInAs("admin");
    serverGrants("admin", ALL_FEATURES);

    const { result } = renderPermissions();

    expect(result.current.status).toBe("loading");
    expect(result.current.sections).toEqual([]);
    expect(result.current.can("dashboard")).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("offers every section the server granted, in sidebar order", async () => {
    signInAs("admin");
    serverGrants("admin", [...ALL_FEATURES].reverse());

    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.sections.map((section) => section.feature)).toEqual(ALL_FEATURES);
    expect(result.current.firstAllowedPath).toBe("/");
    expect(result.current.can("audit")).toBe(true);
  });

  it("offers only the sections the server granted", async () => {
    signInAs("user");
    serverGrants("user", ["restore", "audit"]);

    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.sections.map((section) => section.path)).toEqual(["/restore", "/audit"]);
    expect(result.current.firstAllowedPath).toBe("/restore");
    expect(result.current.can("restore")).toBe(true);
    expect(result.current.can("dumps")).toBe(false);
  });

  it("has no first route when nothing was granted", async () => {
    signInAs("user");
    serverGrants("user", []);

    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.sections).toEqual([]);
    expect(result.current.firstAllowedPath).toBeNull();
  });

  it("denies a feature it has no section for, even when the server lists it", async () => {
    signInAs("admin");
    serverGrants("admin", ["billing", "dashboard"]);

    const { result } = renderPermissions();
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.sections.map((section) => section.feature)).toEqual(["dashboard"]);
  });

  it("does not ask while nobody is signed in", async () => {
    signInAs(null);

    const { result } = renderPermissions();

    expect(result.current.status).toBe("loading");
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  describe("when the request fails", () => {
    it("reports an error, and offers nothing", async () => {
      signInAs("admin");
      vi.mocked(apiClient.get).mockRejectedValue(new Error("Network Error"));

      const { result } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("error"));

      expect(result.current.sections).toEqual([]);
      expect(result.current.can("dashboard")).toBe(false);
    });

    it("reports the session as unauthorized on a 401, without retrying", async () => {
      signInAs("admin");
      vi.mocked(apiClient.get).mockRejectedValue(httpError(401));

      const { result } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("unauthorized"));

      expect(apiClient.get).toHaveBeenCalledTimes(1);
      expect(result.current.sections).toEqual([]);
    });

    it("reports a 401 on a background refetch as unauthorized, even though an answer is cached", async () => {
      signInAs("admin");
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { role: "admin", features: ALL_FEATURES } })
        .mockRejectedValue(httpError(401));
      const { result } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("ready"));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => expect(result.current.status).toBe("unauthorized"));
      // The revoked session is offered nothing from the cache either.
      expect(result.current.sections).toEqual([]);
      expect(result.current.can("dashboard")).toBe(false);
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });

    it("keeps the cached answer when a background refetch fails for another reason", async () => {
      signInAs("admin");
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { role: "admin", features: ALL_FEATURES } })
        .mockRejectedValue(httpError(500));
      const { result } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("ready"));

      await act(async () => {
        result.current.refetch();
      });

      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(4));
      expect(result.current.status).toBe("ready");
      expect(result.current.sections).toHaveLength(ALL_FEATURES.length);
    });

    it("keeps any other HTTP failure an error", async () => {
      signInAs("admin");
      vi.mocked(apiClient.get).mockRejectedValue(httpError(500));

      const { result } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("error"));
    });
  });

  describe("when the browser is offline", () => {
    it("reports an error instead of loading forever, and recovers when it is back", async () => {
      signInAs("admin");
      serverGrants("admin", ALL_FEATURES);
      onlineManager.setOnline(false);

      const { result } = renderPermissions();

      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(apiClient.get).not.toHaveBeenCalled();

      onlineManager.setOnline(true);
      await waitFor(() => expect(result.current.status).toBe("ready"));
    });
  });

  describe("when the session changes", () => {
    it("never shows the previous user's permissions to the next one", async () => {
      signInAs("admin", "u1", "s1");
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { role: "admin", features: ALL_FEATURES } })
        .mockResolvedValueOnce({ data: { role: "user", features: [] } });
      const { result, rerender } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.sections).toHaveLength(ALL_FEATURES.length);

      signInAs("user", "u2", "s2");
      rerender();

      expect(result.current.status).toBe("loading");
      expect(result.current.sections).toEqual([]);
      expect(result.current.can("dashboard")).toBe(false);
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.sections).toEqual([]);
    });

    it("does not reuse the permissions cached for the same user's earlier session", async () => {
      signInAs("admin", "u1", "s1");
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { role: "admin", features: ALL_FEATURES } })
        .mockResolvedValueOnce({ data: { role: "admin", features: ["audit"] } });
      const { result, rerender } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("ready"));

      signInAs("admin", "u1", "s2");
      rerender();

      expect(result.current.status).toBe("loading");
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.sections.map((section) => section.feature)).toEqual(["audit"]);
    });

    it("drops the cached permissions of every other session", async () => {
      signInAs("admin", "u1", "s1");
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { role: "admin", features: ALL_FEATURES } })
        .mockResolvedValueOnce({ data: { role: "user", features: [] } });
      const { client, result, rerender } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("ready"));

      signInAs("user", "u2", "s2");
      rerender();
      await waitFor(() => expect(result.current.status).toBe("ready"));

      await waitFor(() => {
        const keys = client
          .getQueryCache()
          .findAll({ queryKey: PERMISSIONS_QUERY_KEY })
          .map((query) => query.queryKey);
        expect(keys).toEqual([[...PERMISSIONS_QUERY_KEY, "u2", "s2"]]);
      });
    });

    it("drops the cached permissions when the user signs out", async () => {
      signInAs("admin", "u1", "s1");
      serverGrants("admin", ALL_FEATURES);
      const { client, result, rerender } = renderPermissions();
      await waitFor(() => expect(result.current.status).toBe("ready"));

      signInAs(null);
      rerender();

      await waitFor(() => {
        const withData = client
          .getQueryCache()
          .findAll({ queryKey: PERMISSIONS_QUERY_KEY })
          .filter((query) => query.state.data !== undefined);
        expect(withData).toEqual([]);
      });
    });
  });
});
