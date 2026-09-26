import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Breadcrumbs } from "../Breadcrumbs";

function renderWithRouter(ui: React.ReactElement, { route = "/" } = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

describe("Breadcrumbs", () => {
  it('renders "Dashboard" as active when at root', () => {
    renderWithRouter(<Breadcrumbs />, { route: "/" });
    const dashboard = screen.getByText("Dashboard");
    expect(dashboard).toBeInTheDocument();
    expect(dashboard.tagName).toBe("SPAN");
  });

  it("renders breadcrumb trail for nested path", () => {
    renderWithRouter(<Breadcrumbs />, { route: "/dumps" });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Respaldos")).toBeInTheDocument();
    // Dashboard should be a link
    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink).toHaveAttribute("href", "/");
  });

  it("last segment is not a link", () => {
    renderWithRouter(<Breadcrumbs />, { route: "/audit" });
    const audit = screen.getByText("Auditoría");
    expect(audit.tagName).toBe("SPAN");
  });

  it("renders correct labels for known routes", () => {
    renderWithRouter(<Breadcrumbs />, { route: "/cleanup" });
    expect(screen.getByText("Limpieza")).toBeInTheDocument();
  });

  it("capitalizes unknown segments", () => {
    renderWithRouter(<Breadcrumbs />, { route: "/settings" });
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("has correct aria-label", () => {
    renderWithRouter(<Breadcrumbs />, { route: "/dumps" });
    expect(screen.getByLabelText("Breadcrumbs")).toBeInTheDocument();
  });
});
