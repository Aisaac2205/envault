import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Topbar } from "../Topbar";
import { __internalReset } from "@/shared/hooks/useTheme";

function renderWithRouter(ui: React.ReactElement, { route = "/" } = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

function clearStorage() {
  localStorage.removeItem("vaultly:theme");
}

beforeEach(() => {
  clearStorage();
  __internalReset();
});

describe("Topbar", () => {
  it("renders breadcrumbs", () => {
    renderWithRouter(<Topbar />, { route: "/dumps" });
    expect(screen.getByText("Respaldos")).toBeInTheDocument();
  });

  it("renders theme toggle button", () => {
    renderWithRouter(<Topbar />, { route: "/" });
    const themeBtn = screen.getByLabelText("Toggle theme");
    expect(themeBtn).toBeInTheDocument();
  });

  it("is hidden on mobile by default (hidden md:flex)", () => {
    renderWithRouter(<Topbar />, { route: "/" });
    const header = document.querySelector("header");
    expect(header).toHaveClass("hidden");
    expect(header).toHaveClass("md:flex");
  });

  it("shows Sun icon when resolved theme is light (default)", () => {
    renderWithRouter(<Topbar />, { route: "/" });
    const btn = screen.getByLabelText("Toggle theme");
    const svg = btn.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("shows Moon icon when resolved theme is dark", () => {
    localStorage.setItem("vaultly:theme", "dark");
    __internalReset();
    renderWithRouter(<Topbar />, { route: "/" });
    const btn = screen.getByLabelText("Toggle theme");
    const svg = btn.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("clicking theme toggle button toggles data-theme on <html>", () => {
    // Start from light so first toggle goes light → dark
    localStorage.setItem("vaultly:theme", "light");
    __internalReset();
    renderWithRouter(<Topbar />, { route: "/" });
    const btn = screen.getByLabelText("Toggle theme");

    // Before click: light (default) → no data-theme
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    fireEvent.click(btn);

    // After click: toggled to dark → data-theme="dark" on <html>
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(btn);

    // Next click: dark → system, resolved depends on OS pref (light) → no data-theme
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
