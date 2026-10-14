import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { authClient } from "@/shared/lib/auth-client";
import { routes } from "./router";

vi.mock("@/shared/lib/auth-client", () => ({
  authClient: { useSession: vi.fn() },
}));

// Every feature screen is replaced by a one-line stand-in: these tests are
// about which screen the route table picks, not about what the screens do.
vi.mock("./shared/lib/lazy-routes", async () => {
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

vi.mock("./features/auth/LoginPage", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Login screen") };
});

vi.mock("./features/users", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("p", null, "Users screen") };
});

function signInAs(role: "admin" | "user" | null) {
  vi.mocked(authClient.useSession).mockReturnValue({
    data: role
      ? { user: { id: "u1", email: "ana@envault.local", name: "Ana", role } }
      : null,
    isPending: false,
  } as unknown as ReturnType<typeof authClient.useSession>);
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("route table", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("known addresses", () => {
    it.each([
      ["admin", "/", "Dashboard screen"],
      ["admin", "/dumps", "Dumps screen"],
      ["admin", "/cleanup", "Cleanup screen"],
      ["admin", "/restore", "Restore screen"],
      ["admin", "/cronjobs", "Cronjobs screen"],
      ["admin", "/connections", "Connections screen"],
      ["admin", "/users", "Users screen"],
      ["admin", "/audit", "Audit screen"],
      ["admin", "/audit/log-1", "Audit detail screen"],
      ["user", "/restore", "Restore screen"],
    ] as const)("opens %s at %s", async (role, path, expected) => {
      signInAs(role);

      renderAt(path);

      expect(await screen.findByText(expected)).toBeInTheDocument();
    });

    it("opens the login screen without a session", async () => {
      signInAs(null);

      renderAt("/login");

      expect(await screen.findByText("Login screen")).toBeInTheDocument();
    });

    it("keeps sending a regular user away from an admin-only screen", async () => {
      signInAs("user");

      const router = renderAt("/connections");

      expect(await screen.findByText("Dashboard screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
    });

    it("keeps sending a signed-out visitor to the login screen", async () => {
      signInAs(null);

      const router = renderAt("/connections");

      expect(await screen.findByText("Login screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  describe("unknown addresses", () => {
    it("shows a not-found screen inside the app shell to a signed-in user", async () => {
      signInAs("admin");

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

    it("shows it to a regular user as well", async () => {
      signInAs("user");

      renderAt("/no/such/screen");

      expect(
        await screen.findByRole("heading", { name: "Página no encontrada" }),
      ).toBeInTheDocument();
    });

    it("keeps the unknown address in the URL instead of redirecting", async () => {
      signInAs("admin");

      const router = renderAt("/no/such/screen");

      await screen.findByRole("heading", { name: "Página no encontrada" });
      expect(router.state.location.pathname).toBe("/no/such/screen");
    });

    it("offers a way back to the dashboard", async () => {
      const user = userEvent.setup();
      signInAs("admin");
      const router = renderAt("/no/such/screen");

      await user.click(
        await screen.findByRole("link", { name: "Volver al Dashboard" }),
      );

      expect(await screen.findByText("Dashboard screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/");
    });

    it("treats a signed-out visitor like on any protected address", async () => {
      signInAs(null);

      const router = renderAt("/no/such/screen");

      expect(await screen.findByText("Login screen")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/login");
      expect(
        screen.queryByRole("heading", { name: "Página no encontrada" }),
      ).not.toBeInTheDocument();
    });
  });
});
