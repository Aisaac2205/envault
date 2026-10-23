import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import apiClient from "@/shared/lib/api-client";
import { authClient } from "@/shared/lib/auth-client";
import { clearSessionRejected, isSessionRejected } from "@/shared/lib/session-rejected";
import { ProtectedRoute } from "../ProtectedRoute";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { useSession: vi.fn(), signOut: vi.fn() },
}));
vi.mock("@/shared/lib/api-client", () => ({
  default: { get: vi.fn() },
}));

function signedIn(signedIn: boolean, isPending = false) {
  vi.mocked(authClient.useSession).mockReturnValue({
    data: signedIn
      ? {
          user: { id: "u1", email: "ana@envault.local", name: "Ana", role: "user" },
          session: { id: "s1" },
        }
      : null,
    isPending,
  } as unknown as ReturnType<typeof authClient.useSession>);
}

function serverGrants(features: string[]) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { role: "user", features } });
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderGuarded(feature?: "restore" | "audit") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/guarded"]}>
        <Routes>
          <Route
            path="/guarded"
            element={
              <ProtectedRoute feature={feature}>
                <p>The screen</p>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSessionRejected();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    clearSessionRejected();
  });

  it("sends a signed-out visitor to the login screen", async () => {
    signedIn(false);

    renderGuarded("restore");

    expect(await screen.findByTestId("where")).toHaveTextContent("/login");
  });

  it("shows the app loader, and nothing else, while the session is still being resolved", () => {
    signedIn(false, true);

    renderGuarded("restore");

    expect(screen.getByRole("status", { name: "Cargando página" })).toBeInTheDocument();
    expect(screen.queryByText("The screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
  });

  it("shows the app loader, and does not redirect, while the permissions are loading", () => {
    signedIn(true);
    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {}));

    renderGuarded("restore");

    expect(screen.getByRole("status", { name: "Cargando página" })).toBeInTheDocument();
    expect(screen.queryByText("The screen")).not.toBeInTheDocument();
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
  });

  it("renders the screen when the server granted its feature", async () => {
    signedIn(true);
    serverGrants(["restore"]);

    renderGuarded("restore");

    expect(await screen.findByText("The screen")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("redirects to the first granted section, in sidebar order", async () => {
    signedIn(true);
    serverGrants(["audit"]);

    renderGuarded("restore");

    expect(await screen.findByTestId("where")).toHaveTextContent("/audit");
    expect(screen.queryByText("The screen")).not.toBeInTheDocument();
  });

  it("redirects to the no-access screen when nothing was granted", async () => {
    signedIn(true);
    serverGrants([]);

    renderGuarded("restore");

    expect(await screen.findByTestId("where")).toHaveTextContent("/no-access");
  });

  it("lets any signed-in user through a route that names no feature", async () => {
    signedIn(true);
    serverGrants([]);

    renderGuarded();

    expect(await screen.findByText("The screen")).toBeInTheDocument();
  });

  describe("when the server cannot be asked", () => {
    beforeEach(() => {
      signedIn(true);
      vi.mocked(apiClient.get).mockRejectedValue(new Error("Network Error"));
    });

    it("explains it instead of showing the screen or an endless loader", async () => {
      renderGuarded("restore");

      expect(
        await screen.findByText("No se pudieron cargar tus permisos"),
      ).toBeInTheDocument();
      expect(screen.queryByText("The screen")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("offers a way to try again that opens the screen once the server answers", async () => {
      const user = userEvent.setup();
      renderGuarded("restore");
      await screen.findByText("No se pudieron cargar tus permisos");

      serverGrants(["restore"]);
      await user.click(screen.getByRole("button", { name: "Reintentar" }));

      expect(await screen.findByText("The screen")).toBeInTheDocument();
    });

    it("keeps logging out reachable", async () => {
      renderGuarded("restore");

      expect(
        await screen.findByRole("button", { name: "Cerrar sesión" }),
      ).toBeInTheDocument();
    });
  });

  describe("when the browser is offline", () => {
    it("explains it, with retry and log out, instead of spinning forever", async () => {
      signedIn(true);
      serverGrants(["restore"]);
      onlineManager.setOnline(false);

      renderGuarded("restore");

      expect(
        await screen.findByText("No se pudieron cargar tus permisos"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();

      onlineManager.setOnline(true);
      expect(await screen.findByText("The screen")).toBeInTheDocument();
    });
  });

  describe("when the API says the session is no longer valid (401)", () => {
    beforeEach(() => {
      signedIn(true);
      vi.mocked(apiClient.get).mockRejectedValue(
        new AxiosError("Unauthorized", "ERR_BAD_REQUEST", undefined, undefined, {
          status: 401,
        } as AxiosResponse),
      );
      vi.mocked(authClient.signOut).mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof authClient.signOut>>,
      );
    });

    it("ends the stale session and goes to the login screen, not to the unavailable screen", async () => {
      renderGuarded("restore");

      expect(await screen.findByTestId("where")).toHaveTextContent("/login");
      expect(authClient.signOut).toHaveBeenCalled();
      expect(screen.queryByText("No se pudieron cargar tus permisos")).not.toBeInTheDocument();
    });

    it("still leaves, and notes the rejected session, when the sign-out is itself refused (429)", async () => {
      vi.mocked(authClient.signOut).mockResolvedValue({
        data: null,
        error: { status: 429, message: "Too many requests" },
      } as unknown as Awaited<ReturnType<typeof authClient.signOut>>);

      renderGuarded("restore");

      expect(await screen.findByTestId("where")).toHaveTextContent("/login");
      // Asked once: the login screen has the note, so nothing sends the visitor back here.
      expect(authClient.signOut).toHaveBeenCalledTimes(1);
      expect(isSessionRejected()).toBe(true);
    });
  });
});
