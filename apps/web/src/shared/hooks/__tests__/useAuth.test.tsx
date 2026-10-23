import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { authClient } from "@/shared/lib/auth-client";
import { PERMISSIONS_QUERY_KEY } from "@/shared/lib/permissions-query-key";
import {
  clearSessionRejected,
  isSessionRejected,
  markSessionRejected,
} from "@/shared/lib/session-rejected";
import { useAuth } from "../useAuth";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { useSession: vi.fn(), signOut: vi.fn() },
}));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAuth() {
  const client = new QueryClient();
  client.setQueryData([...PERMISSIONS_QUERY_KEY, "u1", "s1"], { role: "admin", features: ["audit"] });
  client.setQueryData([...PERMISSIONS_QUERY_KEY, "u2", "s2"], { role: "user", features: [] });
  client.setQueryData(["connections"], [{ id: "c1" }]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/restore"]}>
        <Where />
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...renderHook(() => useAuth(), { wrapper }) };
}

const signedOut = () =>
  vi.mocked(authClient.signOut).mockResolvedValue({
    data: { success: true },
    error: null,
  } as unknown as Awaited<ReturnType<typeof authClient.signOut>>);

describe("useAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSessionRejected();
    vi.mocked(authClient.useSession).mockReturnValue({
      data: {
        user: { id: "u1", email: "ana@envault.local", name: "Ana", role: "admin" },
        session: { id: "s1" },
      },
      isPending: false,
    } as unknown as ReturnType<typeof authClient.useSession>);
  });

  it("exposes the id of the session", () => {
    const { result } = renderAuth();

    expect(result.current.sessionId).toBe("s1");
  });

  it("has no session id when nobody is signed in", () => {
    vi.mocked(authClient.useSession).mockReturnValue({
      data: null,
      isPending: false,
    } as unknown as ReturnType<typeof authClient.useSession>);

    const { result } = renderAuth();

    expect(result.current.sessionId).toBeNull();
  });

  describe("logout", () => {
    it("signs out, forgets every cached permission and goes to the login screen", async () => {
      signedOut();
      const { client, result } = renderAuth();

      await act(() => result.current.logout());

      expect(authClient.signOut).toHaveBeenCalled();
      expect(client.getQueryData([...PERMISSIONS_QUERY_KEY, "u1", "s1"])).toBeUndefined();
      expect(client.getQueryData([...PERMISSIONS_QUERY_KEY, "u2", "s2"])).toBeUndefined();
      // Unrelated cache entries are left alone.
      expect(client.getQueryData(["connections"])).toEqual([{ id: "c1" }]);
      expect(screen.getByTestId("where")).toHaveTextContent("/login");
      expect(isSessionRejected()).toBe(false);
    });

    it("forgets an earlier rejected-session note once the session really ended", async () => {
      markSessionRejected();
      signedOut();
      const { result } = renderAuth();

      await act(() => result.current.logout());

      expect(isSessionRejected()).toBe(false);
    });

    describe("when the sign-out request fails", () => {
      it("does not reject, still forgets the permissions, leaves, and notes the rejected session", async () => {
        vi.mocked(authClient.signOut).mockRejectedValue(new Error("Network Error"));
        const { client, result } = renderAuth();

        await act(() => result.current.logout());

        expect(client.getQueryData([...PERMISSIONS_QUERY_KEY, "u1", "s1"])).toBeUndefined();
        expect(screen.getByTestId("where")).toHaveTextContent("/login");
        expect(isSessionRejected()).toBe(true);
      });

      it("treats an answer with an error (such as a 429) as a failure too", async () => {
        vi.mocked(authClient.signOut).mockResolvedValue({
          data: null,
          error: { status: 429, message: "Too many requests" },
        } as unknown as Awaited<ReturnType<typeof authClient.signOut>>);
        const { client, result } = renderAuth();

        await act(() => result.current.logout());

        expect(client.getQueryData([...PERMISSIONS_QUERY_KEY, "u1", "s1"])).toBeUndefined();
        expect(screen.getByTestId("where")).toHaveTextContent("/login");
        expect(isSessionRejected()).toBe(true);
      });
    });
  });
});
