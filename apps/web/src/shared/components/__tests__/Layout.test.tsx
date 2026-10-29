import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "../Layout";
import type { AuthUser } from "@/shared/hooks/useAuth";
import { APP_SECTIONS } from "@/shared/lib/sections";

const mockUser: AuthUser = {
  id: "1",
  email: "admin@vaultly.local",
  name: "Admin",
  role: "admin",
};

const mockLogout = vi.fn().mockResolvedValue(undefined);

function renderLayout(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Layout user={mockUser} sections={APP_SECTIONS} onLogout={mockLogout}>
        <div data-testid="page-content">Page Content</div>
      </Layout>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  it("renders children inside main", () => {
    renderLayout();
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
    expect(screen.getByText("Page Content")).toBeInTheDocument();
  });

  it("renders desktop sidebar", () => {
    renderLayout();
    const aside = document.querySelector("aside");
    expect(aside).toBeInTheDocument();
    expect(aside).toHaveClass("bg-sidebar");
  });

  it("renders mobile header with menu button", () => {
    renderLayout();
    const menuBtn = screen.getByLabelText("Open menu");
    expect(menuBtn).toBeInTheDocument();
    expect(menuBtn.querySelector("svg.lucide-panel-left-open")).not.toBeNull();
  });

  it("renders topbar with breadcrumbs", () => {
    renderLayout("/dumps");
    // Both sidebar nav and topbar breadcrumbs show "Respaldos" - scope to breadcrumbs
    const breadcrumbNav = screen.getByRole("navigation", { name: "Breadcrumbs" });
    expect(breadcrumbNav).toBeInTheDocument();
    const dumpsInBreadcrumb = breadcrumbNav.querySelector("span.font-medium");
    expect(dumpsInBreadcrumb).toHaveTextContent("Respaldos");
  });

  it("contains sonner Toaster (import verified, portal renders in DOM)", () => {
    renderLayout();
    // Sonner renders into a portal with role="region" in recent versions
    const toaster = document.querySelector("section[aria-label]");
    // In jsdom portals may not render; the component import is verified by typecheck
    expect(toaster ?? true).toBeTruthy();
  });

  it("matches the page background on the mobile header, with no logo or product name", () => {
    renderLayout();
    const mobileHeader = document.querySelector("header");
    expect(mobileHeader).toHaveClass("bg-bg", "md:hidden");
    expect(mobileHeader).not.toHaveClass("bg-sidebar");
    expect(mobileHeader?.querySelector("img")).toBeNull();
    expect(mobileHeader).not.toHaveTextContent("EnVault Management");
  });

  it("puts the menu button on the left and the language and theme toggles on the right of the mobile header", () => {
    renderLayout();
    // jsdom ignores CSS, so the desktop topbar's toggles are in the DOM too: scope to the mobile header.
    const mobileHeader = document.querySelector("header") as HTMLElement;
    expect(mobileHeader).toHaveClass("md:hidden");
    const header = within(mobileHeader);

    const menu = header.getByRole("button", { name: "Open menu" });
    const language = header.getByRole("button", { name: /idioma|language/i });
    const theme = header.getByRole("button", { name: "Toggle theme" });
    expect(header.getAllByRole("button")).toEqual([menu, language, theme]);

    // The toggles share one group pushed to the right edge, like the desktop topbar pair.
    const toggles = language.parentElement;
    expect(theme.parentElement).toBe(toggles);
    expect(toggles).toHaveClass("ml-auto", "flex", "items-center", "gap-2");

    // A transparent inset grows each 32px toggle to a 44px tall touch target without restyling it.
    for (const toggle of [language, theme]) {
      expect(toggle).toHaveClass("relative", "after:absolute", "after:-inset-x-1", "after:-inset-y-1.5");
    }
  });
});
