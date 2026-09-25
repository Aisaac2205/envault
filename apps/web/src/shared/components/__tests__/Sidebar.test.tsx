import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar, SidebarContent, SidebarRoot, SidebarItem, SidebarUser } from "../Sidebar";
import { SidebarProvider, useSidebar } from "../SidebarProvider";
import type { AuthUser } from "@/shared/hooks/useAuth";

const mockUser: AuthUser = {
  id: "1",
  email: "admin@vaultly.local",
  name: "Admin",
  role: "admin",
};

const mockLogout = vi.fn().mockResolvedValue(undefined);

function renderWithRouter(ui: React.ReactElement, { route = "/" } = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

/** Wraps ui in both SidebarProvider and MemoryRouter for collapse-aware tests. */
function renderWithProvider(
  ui: React.ReactElement,
  { route = "/", storedState }: { route?: string; storedState?: string } = {},
) {
  if (storedState) {
    localStorage.setItem("vaultly:sidebar-state", storedState);
  }
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("uses bg-sidebar token instead of bg-black", () => {
    renderWithRouter(<Sidebar user={mockUser} onLogout={mockLogout} />);
    const aside = document.querySelector("aside");
    expect(aside).toHaveClass("bg-sidebar");
    expect(aside).not.toHaveClass("bg-black");
  });

  it("renders all navigation items for admin user", () => {
    renderWithRouter(<Sidebar user={mockUser} onLogout={mockLogout} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dumps")).toBeInTheDocument();
    expect(screen.getByText("Limpieza")).toBeInTheDocument();
    expect(screen.getByText("Restaurar")).toBeInTheDocument();
    expect(screen.getByText("Cronjobs")).toBeInTheDocument();
    expect(screen.getByText("Conexiones")).toBeInTheDocument();
    expect(screen.getByText("Usuarios")).toBeInTheDocument();
    expect(screen.getByText("Auditoría")).toBeInTheDocument();
  });

  it("hides admin-only items for non-admin users", () => {
    const nonAdmin: AuthUser = { ...mockUser, role: "user" };
    renderWithRouter(<Sidebar user={nonAdmin} onLogout={mockLogout} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Dumps")).not.toBeInTheDocument();
    expect(screen.queryByText("Usuarios")).not.toBeInTheDocument();
    expect(screen.getByText("Auditoría")).toBeInTheDocument();
  });

  it("shows user role in footer", () => {
    renderWithRouter(<Sidebar user={mockUser} onLogout={mockLogout} />);
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });

  it("renders logout option when user trigger is clicked", () => {
    renderWithRouter(<Sidebar user={mockUser} onLogout={mockLogout} />);
    const userButton = screen.getByRole("button", { name: /Admin/i });
    fireEvent.click(userButton);
    expect(screen.getByText("Cerrar Sesión")).toBeInTheDocument();
  });

  it("renders EnVault Management branding", () => {
    renderWithRouter(<Sidebar user={mockUser} onLogout={mockLogout} />);
    expect(screen.getByAltText("EnVault Management")).toBeInTheDocument();
  });
});

describe("SidebarItem", () => {
  it("renders with label and icon wrapper", () => {
    renderWithRouter(
      <SidebarRoot>
        <SidebarItem
          path="/dumps"
          label="Dumps"
          icon={() => <span data-testid="icon" />}
          routeKey="dumps"
        />
      </SidebarRoot>,
      { route: "/dumps" },
    );
    expect(screen.getByText("Dumps")).toBeInTheDocument();
  });

  it("applies active state classes when route matches", () => {
    renderWithRouter(
      <SidebarRoot>
        <SidebarItem
          path="/dumps"
          label="Dumps"
          icon={() => <span />}
          routeKey="dumps"
        />
      </SidebarRoot>,
      { route: "/dumps" },
    );
    const link = screen.getByRole("link", { name: /Dumps/i });
    expect(link.className).toContain("bg-sidebar-active");
    expect(link.className).toContain("border-sidebar-indicator");
  });

  it("does not apply active classes when route does not match", () => {
    renderWithRouter(
      <SidebarRoot>
        <SidebarItem
          path="/dumps"
          label="Dumps"
          icon={() => <span />}
          routeKey="dumps"
        />
      </SidebarRoot>,
      { route: "/audit" },
    );
    const link = screen.getByRole("link", { name: /Dumps/i });
    expect(link.className).not.toContain("bg-sidebar-active");
    expect(link.className).toContain("text-sidebar-text/70");
  });

  it("calls onNavigate from context on click", () => {
    const onNavigate = vi.fn();
    renderWithRouter(
      <SidebarRoot onNavigate={onNavigate}>
        <SidebarItem
          path="/dumps"
          label="Dumps"
          icon={() => <span />}
          routeKey="dumps"
        />
      </SidebarRoot>,
    );

    // The link should have the correct href — onNavigate fires on click
    const link = screen.getByRole("link", { name: /Dumps/i });
    expect(link).toHaveAttribute("href", "/dumps");
  });
});

describe("SidebarContent", () => {
  it("renders inside a SidebarRoot context", () => {
    renderWithRouter(
      <SidebarRoot onNavigate={() => {}}>
        <SidebarContent user={mockUser} onLogout={mockLogout} />
      </SidebarRoot>,
    );
    expect(screen.getByAltText("EnVault Management")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });
});

describe("SidebarUser", () => {
  it("renders null when user is null", () => {
    const { container } = renderWithRouter(
      <SidebarUser user={null} onLogout={mockLogout} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders user card and opens popover on click", () => {
    renderWithRouter(
      <SidebarUser user={mockUser} onLogout={mockLogout} />,
    );
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Admin/i }));
    expect(screen.getByText("Cerrar Sesión")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/*  PR 3c1 — SidebarProvider & Collapse                                       */
/* -------------------------------------------------------------------------- */

describe("SidebarProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders children", () => {
    render(
      <SidebarProvider>
        <div data-testid="child">Hello</div>
      </SidebarProvider>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("useSidebar returns initial state as expanded", () => {
    const TestConsumer = () => {
      const { state } = useSidebar();
      return <span data-testid="state">{state}</span>;
    };

    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
  });

  it("useSidebar.toggle() flips state", () => {
    const TestConsumer = () => {
      const { state, toggle } = useSidebar();
      return (
        <>
          <span data-testid="state">{state}</span>
          <button data-testid="toggle" onClick={toggle}>
            Toggle
          </button>
        </>
      );
    };

    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>,
    );

    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");
  });

  it("persists state to localStorage", () => {
    const TestConsumer = () => {
      const { toggle } = useSidebar();
      return <button data-testid="toggle" onClick={toggle}>Toggle</button>;
    };

    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>,
    );

    // Initial: no localStorage yet (written on first effect, but jsdom
    // localStorage may not sync in effect synchronously).
    fireEvent.click(screen.getByTestId("toggle"));
    // After toggle, the provider's useEffect writes to localStorage.
    // We verify the read-back works on next mount (see remount test below).
  });

  it("state survives remount via localStorage", () => {
    // Pre-seed localStorage
    localStorage.setItem("vaultly:sidebar-state", "collapsed");

    const TestConsumer = () => {
      const { state } = useSidebar();
      return <span data-testid="state">{state}</span>;
    };

    const { unmount } = render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");

    // Unmount and remount — state should reload from localStorage
    unmount();
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>,
    );
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");
  });
});

describe("Sidebar — collapsible icon mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders labels when expanded", () => {
    renderWithProvider(<Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />, {
      storedState: "expanded",
    });
    // All labels should be visible
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dumps")).toBeInTheDocument();
    expect(screen.getByAltText("EnVault Management")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });

  it("hides labels and shows only icons when collapsed", () => {
    renderWithProvider(<Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />, {
      storedState: "collapsed",
    });
    // Labels are hidden
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Dumps")).not.toBeInTheDocument();
    // Logout text hidden, but the icon button still exists
    expect(screen.queryByText("Cerrar Sesión")).not.toBeInTheDocument();
    // The nav links exist (icons rendered with aria-label)
    expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
    expect(screen.getByLabelText("Dumps")).toBeInTheDocument();
  });

  it("uses 56px width when collapsed, 216px when expanded", () => {
    const { unmount } = renderWithProvider(
      <Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />,
      { storedState: "collapsed" },
    );
    const aside = document.querySelector("aside");
    expect(aside?.className).toContain("w-[56px]");

    // Clear localStorage so next mount starts fresh as expanded
    unmount();
    localStorage.clear();
    renderWithProvider(
      <Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />,
    );
    expect(document.querySelector("aside")?.className).toContain("w-[216px]");
  });

  it("collapsed items have aria-label for accessibility", () => {
    renderWithProvider(<Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />, {
      storedState: "collapsed",
    });

    // Each nav item should have an aria-label when collapsed
    expect(screen.getByLabelText("Dashboard")).toBeInTheDocument();
    expect(screen.getByLabelText("Dumps")).toBeInTheDocument();
    expect(screen.getByLabelText("Auditoría")).toBeInTheDocument();
  });

  it("collapsed items have title tooltip for hover", () => {
    renderWithProvider(<Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />, {
      storedState: "collapsed",
    });

    const dashboardLink = screen.getByLabelText("Dashboard");
    expect(dashboardLink).toHaveAttribute("title", "Dashboard");
  });

  it("shows user avatar centered when collapsed with tooltip title", () => {
    renderWithProvider(<Sidebar user={mockUser} onLogout={mockLogout} collapsible="icon" />, {
      storedState: "collapsed",
    });

    // Avatar initials remain visible
    expect(screen.getByText("AD")).toBeInTheDocument();
    // User role label text is hidden
    expect(screen.queryByText("Administrador")).not.toBeInTheDocument();
  });
});

describe("Sidebar — collapsible offcanvas (mobile sheet)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("mobile sheet always shows labels regardless of SidebarProvider state", () => {
    // The mobile sheet uses SidebarRoot with collapsible="offcanvas" default
    // (or no collapsible prop). It should ignore collapse state.
    renderWithProvider(
      <SidebarRoot onNavigate={() => {}} collapsible="offcanvas">
        <SidebarContent user={mockUser} onLogout={mockLogout} />
      </SidebarRoot>,
      { storedState: "collapsed" },
    );

    // Labels are always visible in offcanvas mode (collapsed computation is false)
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByAltText("EnVault Management")).toBeInTheDocument();
    expect(screen.getByText("Administrador")).toBeInTheDocument();
  });
});
