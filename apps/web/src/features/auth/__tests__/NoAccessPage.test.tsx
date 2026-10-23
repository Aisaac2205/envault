import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import apiClient from "@/shared/lib/api-client";
import { authClient } from "@/shared/lib/auth-client";
import NoAccessPage from "../NoAccessPage";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { useSession: vi.fn(), signOut: vi.fn() },
}));
vi.mock("@/shared/lib/api-client", () => ({
  default: { get: vi.fn() },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/no-access"]}>
        <Routes>
          <Route path="/no-access" element={<NoAccessPage />} />
          <Route path="/login" element={<p>Login screen</p>} />
          <Route path="*" element={<p>Somewhere else</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NoAccessPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authClient.useSession).mockReturnValue({
      data: { user: { id: "u1", email: "ana@envault.local", name: "Ana", role: "user" } },
      isPending: false,
    } as unknown as ReturnType<typeof authClient.useSession>);
  });

  describe("for a user the server granted nothing", () => {
    beforeEach(() => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { role: "user", features: [] } });
    });

    it("says they have no access and who to ask", async () => {
      renderPage();

      expect(
        await screen.findByRole("heading", { level: 1, name: "Sin acceso" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "No tienes acceso a ninguna sección" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Solicita acceso a un administrador.")).toBeInTheDocument();
    });

    it("keeps logging out reachable", async () => {
      const user = userEvent.setup();
      vi.mocked(authClient.signOut).mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof authClient.signOut>>,
      );
      renderPage();

      await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

      expect(authClient.signOut).toHaveBeenCalled();
      expect(await screen.findByText("Login screen")).toBeInTheDocument();
    });
  });

  it("sends a user who does have a section to it", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { role: "viewer", features: ["audit"] },
    });

    renderPage();

    expect(await screen.findByText("Somewhere else")).toBeInTheDocument();
    expect(screen.queryByText("No tienes acceso a ninguna sección")).not.toBeInTheDocument();
  });
});
