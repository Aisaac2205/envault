import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import NotFound from "../index";

function renderNotFound() {
  return render(
    <MemoryRouter initialEntries={["/no/such/screen"]}>
      <NotFound />
    </MemoryRouter>,
  );
}

describe("NotFound", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("es");
  });

  it("explains the problem and links back to the dashboard in Spanish", () => {
    renderNotFound();

    expect(
      screen.getByRole("heading", { level: 1, name: "Página no encontrada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No encontramos esa página")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver al Dashboard" }),
    ).toHaveAttribute("href", "/");
  });

  it("explains the problem and links back to the dashboard in English", async () => {
    await i18n.changeLanguage("en");

    renderNotFound();

    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeInTheDocument();
    expect(screen.getByText("We couldn't find that page")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Dashboard" }),
    ).toHaveAttribute("href", "/");
  });
});
