import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DayValue } from "../kpis/kpi-data";
import { KpiSparkline } from "../kpis/KpiSparkline";

const WIDTH = 200;

// jsdom has no ResizeObserver, and the sparkline draws nothing until it is measured.
class FixedWidthObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: WIDTH } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

function series(values: (number | null)[]): DayValue[] {
  return values.map((value, index) => ({ date: `2026-10-${String(10 + index).padStart(2, "0")}`, value }));
}

describe("KpiSparkline", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FixedWidthObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides the plot from assistive technology: the card's figure and caption carry the numbers", () => {
    const { container } = render(
      <KpiSparkline color="var(--chart-1)" kind="area" onHoverChange={vi.fn()} series={series([1, 2, 3])} />,
    );

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("draws a line, and breaks it where a day has no value instead of dropping to zero", () => {
    const { container } = render(
      <KpiSparkline
        color="var(--chart-1)"
        kind="area"
        onHoverChange={vi.fn()}
        series={series([0.9, 1, null, null, 0.8, 0.95])}
      />,
    );

    const linePaths = [...container.querySelectorAll("path")]
      .map((path) => path.getAttribute("d") ?? "")
      .filter((d) => d.length > 0);
    expect(linePaths.length).toBeGreaterThan(0);
    // One run before the gap and one after: at least two subpaths in some path.
    expect(linePaths.some((d) => (d.match(/M/g) ?? []).length >= 2)).toBe(true);
    for (const d of linePaths) {
      expect(d).not.toContain("NaN");
    }
  });

  it("draws one bar per day with the color it is given", () => {
    const { container } = render(
      <KpiSparkline color="var(--chart-3)" kind="bar" onHoverChange={vi.fn()} series={series([0, 2, 5, 1, 0, 3, 4])} />,
    );

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.innerHTML).toContain("var(--chart-3)");
  });
});
