import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrequencyTabs } from "../FrequencyTabs";

describe("FrequencyTabs: phone layout", () => {
  // Five equal grid cells are narrower than "Semana" in the 360 px restore card,
  // so below sm the tabs share a flex row where each keeps at least its label
  // width; from sm up the five-column grid stays as before. jsdom ignores CSS,
  // so this pins the class contract; the fit is checked in a browser.
  it("uses a flex row below sm and the five-column grid from sm", () => {
    render(<FrequencyTabs value="daily" onChange={vi.fn()} />);

    const list = screen.getByRole("tablist");
    expect(list).toHaveClass("flex", "sm:grid", "sm:grid-cols-5");
    expect(list).not.toHaveClass("grid");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(tab).toHaveClass("flex-1");
    }
  });

  it("keeps every frequency reachable by its full name", () => {
    render(<FrequencyTabs value="daily" onChange={vi.fn()} />);

    for (const name of ["Horarios", "Diarios", "Semanales", "Personalizados", "Manuales"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
  });
});
