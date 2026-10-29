import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrequencyTabs } from "../FrequencyTabs";

describe("FrequencyTabs: layout by the room the form has", () => {
  // Five equal cells clip their labels below about 19rem (54 px a tab): on a
  // phone and in the narrow form column of 1024-1280 px screens. There the tabs
  // share a wrapping row where each keeps at least its label width; with the
  // room, the five-column grid. jsdom ignores CSS, so this pins the class
  // contract; the fit is checked in a browser.
  it("wraps a flex row below 19rem of room and uses the five-column grid from there", () => {
    render(<FrequencyTabs value="daily" onChange={vi.fn()} />);

    const list = screen.getByRole("tablist");
    expect(list.parentElement).toHaveClass("@container/frequency");
    expect(list).toHaveClass("flex", "flex-wrap", "h-auto", "min-h-9", "@[19rem]/frequency:grid", "@[19rem]/frequency:grid-cols-5");
    expect(list).not.toHaveClass("grid");
    expect(list).not.toHaveClass("sm:grid");

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
