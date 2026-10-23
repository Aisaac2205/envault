import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import apiClient from "@/shared/lib/api-client";
import { authClient } from "@/shared/lib/auth-client";
import { APP_SECTIONS } from "@/shared/lib/sections";
import { routes } from "../router";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { useSession: vi.fn(), signOut: vi.fn() },
}));
vi.mock("@/shared/lib/api-client", () => ({
  default: { get: vi.fn() },
}));

// Every feature screen is replaced by a one-line stand-in: these tests are
// about which screen the route table picks, not about what the screens do.
vi.mock("../shared/lib/lazy-routes", async () => {
  const { createElement } = await import("react");
  const screenOf = (name: string) => () =>
    createElement("p", null, `${name} screen`);
  return {
    LazyDashboard: screenOf("Dashboard"),
    LazyDumps: screenOf("Dumps"),
    LazyCleanup: screenOf("Cleanup"),
    LazyRestore: screenOf("Restore"),
    LazyCronjobs: screenOf("Cronjobs"),
    LazyConnections: screenOf("Connections"),
    LazyAudit: screenOf("Audit"),
    LazyAuditDetail: screenOf("Audit detail"),
  };
});

vi.mock("../features/auth/LoginPage", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Login screen") };
});

vi.mock("../features/users", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Users screen") };
});

const ALL_FEATURES = APP_SECTIONS.map(({ feature }) => feature);

// The screen each section opens, by the sidebar path.
const SCREEN_AT: Record<string, string> = {
  "/": "Dashboard screen",
  "/dumps": "Dumps screen",
  "/cleanup": "Cleanup screen",
  "/restore": "Restore screen",
  "/cronjobs": "Cronjobs screen",
  "/connections": "Connections screen",
  "/users": "Users screen",
  "/audit": "Audit screen",
};

/** Signs in as someone the server granted exactly `features`; `null` is signed out. */
function signInWith(features: string[] | null, role = "user") {
  vi.mocked(authClient.useSession).mockReturnValue({
    data: features
      ? { user: { id: "u1", email: "ana@envault.local", name: "Ana", role } }
      : null,
    isPending: false,
  } as unknown as ReturnType<typeof authClient.useSession>);
  vi.mocked(apiClient.get).mockResolvedValue({ data: { role, features: features ?? [] } });
}

const signInAsAdmin = () => signInWith(ALL_FEATURES, "admin");
const signInAsUserWithNothing = () => signInWith([], "user");

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const sidebarLinks = () =>
  within(document.querySelector("aside") as HTMLElement)
    .queryAllByRole("link")
    .map((link) => link.textContent);

describe("route table", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("an administrator", () => {
    beforeEach(signInAsAdmin);

    it.each([
      ...Object.entries(SCREEN_AT),
      ["/audit/log-1", "Audit detail screen"],
    ])("opens %s", async (path, expected) => {
      const router = renderAt(path);

      expect(await screen.findByText(expected)).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(path);
    });

    it("sees every section in the sidebar, in order", async () => {
      renderAt("/");
      await screen.findByText("Dashboard screen");

      expect(sidebarLinks()).toEqual([
        "Dashboard",
        "Respaldos",
        "Limpieza",
        "Restaurar",
        "Cronjobs",
        "Conexiones",
        "Usuarios",
        "Auditoría",
      ]);
    });
  });

  describe("sidebar and routes agree on the permission map", () => {
    const sections = APP_SECTIONS.map((section) => [section.feature, section.path] as const);

    it.each(sections)("a user granted only %s can open %s", async (feature, path) => {
      signInWith([feature]);

      const router = renderAt(path);

      expect(await screen.findByText(SCREEN_AT[path])).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(path);
    });

    it.each(sections)("a user granted everything except %s is turned away from %s", async (feature, path) => {
      const others = ALL_FEATURES.filter((granted) => granted !== feature);
      signInWith(others);

      const router = renderAt(path);

      const first = APP_SECTIONS.find((section) => section.feature === others[0]);
      await screen.findByText(SCREEN_AT[first?.path ?? "/"]);
      expect(router.state.location.pathname).toBe(first?.path);
      expect(screen.queryByText(SCREEN_AT[path])).not.toBeInTheDocument();
    });

    it("sends an audit entry to the audit feature's own gate", async () => {
      signInWith(["restore"]);

      const router = renderAt("/audit/log-1");

      expect(await screen.findByText("Restore screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/restore");
    });
  });

  describe("a user granted only some sections", () => {
    it("is sent to the first granted section, in sidebar order", async () => {
      signInWith(["audit", "restore"], "viewer");

      const router = renderAt("/connections");

      expect(await screen.findByText("Restore screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/restore");
    });

    it("sees only those sections in the sidebar", async () => {
      signInWith(["audit", "restore"], "viewer");
      renderAt("/restore");
      await screen.findByText("Restore screen");

      expect(sidebarLinks()).toEqual(["Restaurar", "Auditoría"]);
    });

    it("is sent away from the no-access screen to a section it may open", async () => {
      signInWith(["audit"], "viewer");

      const router = renderAt("/no-access");

      expect(await screen.findByText("Audit screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/audit");
    });
  });

  describe("a user granted nothing", () => {
    beforeEach(signInAsUserWithNothing);

    it.each([...Object.keys(SCREEN_AT), "/audit/log-1"])(
      "is sent from %s to the no-access screen",
      async (path) => {
        const router = renderAt(path);

        expect(
          await screen.findByRole("heading", { level: 1, name: "Sin acceso" }),
        ).toBeInTheDocument();
        expect(router.state.location.pathname).toBe("/no-access");
      },
    );

    it("is told so, and who to ask, inside the app shell with no sections", async () => {
      renderAt("/");

      expect(
        await screen.findByRole("heading", { name: "No tienes acceso a ninguna sección" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Solicita acceso a un administrador.")).toBeInTheDocument();
      expect(sidebarLinks()).toEqual([]);
    });

    it("can still log out from the no-access screen", async () => {
      const user = userEvent.setup();
      vi.mocked(authClient.signOut).mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof authClient.signOut>>,
      );
      const router = renderAt("/no-access");

      await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

      expect(authClient.signOut).toHaveBeenCalled();
      expect(await screen.findByText("Login screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  describe("while the permissions load", () => {
    it("shows no app shell and no section, and does not redirect", () => {
      signInWith(ALL_FEATURES, "admin");
      vi.mocked(apiClient.get).mockReturnValue(new Promise(() => {}));

      const router = renderAt("/connections");

      expect(document.querySelector("aside")).not.toBeInTheDocument();
      expect(screen.queryByText("Connections screen")).not.toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/connections");
    });
  });

  describe("when the permissions cannot be loaded", () => {
    it("explains it instead of guessing", async () => {
      signInWith(ALL_FEATURES, "admin");
      vi.mocked(apiClient.get).mockRejectedValue(new Error("Network Error"));

      renderAt("/connections");

      expect(
        await screen.findByText("No se pudieron cargar tus permisos"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Connections screen")).not.toBeInTheDocument();
    });
  });

  describe("signed out", () => {
    beforeEach(() => signInWith(null));

    it("opens the login screen", async () => {
      renderAt("/login");

      expect(await screen.findByText("Login screen")).toBeInTheDocument();
    });

    it.each(["/", "/connections", "/audit/log-1", "/no-access", "/no/such/screen"])(
      "sends a visitor from %s to the login screen without asking for permissions",
      async (path) => {
        const router = renderAt(path);

        expect(await screen.findByText("Login screen")).toBeInTheDocument();
        expect(router.state.location.pathname).toBe("/login");
        expect(apiClient.get).not.toHaveBeenCalled();
      },
    );
  });

  describe("unknown addresses", () => {
    it("shows a not-found screen inside the app shell to a signed-in user", async () => {
      signInAsAdmin();

      renderAt("/no/such/screen");

      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "Página no encontrada",
        }),
      ).toBeInTheDocument();
      expect(document.querySelector("aside")).toBeInTheDocument();
      expect(
        screen.queryByText(/Unexpected Application Error/i),
      ).not.toBeInTheDocument();
    });

    it("shows it to a user with no sections as well", async () => {
      signInAsUserWithNothing();

      renderAt("/no/such/screen");

      expect(
        await screen.findByRole("heading", { name: "Página no encontrada" }),
      ).toBeInTheDocument();
    });

    it("keeps the unknown address in the URL instead of redirecting", async () => {
      signInAsAdmin();

      const router = renderAt("/no/such/screen");

      await screen.findByRole("heading", { name: "Página no encontrada" });
      expect(router.state.location.pathname).toBe("/no/such/screen");
    });

    it("offers a way back to the dashboard", async () => {
      const user = userEvent.setup();
      signInAsAdmin();
      const router = renderAt("/no/such/screen");

      await user.click(
        await screen.findByRole("link", { name: "Volver al Dashboard" }),
      );

      expect(await screen.findByText("Dashboard screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
    });

    it("sends a user without the dashboard from that way back to a section they may open", async () => {
      const user = userEvent.setup();
      signInWith(["restore"], "viewer");
      const router = renderAt("/no/such/screen");

      await user.click(
        await screen.findByRole("link", { name: "Volver al Dashboard" }),
      );

      expect(await screen.findByText("Restore screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/restore");
    });
  });
});
