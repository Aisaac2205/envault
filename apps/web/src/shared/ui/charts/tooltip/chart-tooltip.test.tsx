import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Line } from "../line";
import { LineChart } from "../line-chart";
import { ChartTooltip } from "./chart-tooltip";

const rows = [
  { date: new Date("2026-10-25T00:00:00Z"), steady: 10, patchy: 14 },
  { date: new Date("2026-10-26T00:00:00Z"), steady: 12, patchy: null },
  { date: new Date("2026-10-27T00:00:00Z"), steady: 16, patchy: 18 },
];

function renderChart() {
  return render(
    <LineChart animationDuration={0} aspectRatio="" data={rows}>
      <Line animate={false} dataKey="steady" stroke="#111111" />
      <Line animate={false} dataKey="patchy" stroke="#222222" />
      <ChartTooltip content={() => <span>tooltip</span>} />
    </LineChart>,
  );
}

/** Series colors that have a dot. Each dot is a halo circle plus a core circle. */
function dotColors(container: HTMLElement) {
  const fills = Array.from(
    container.querySelectorAll<SVGCircleElement>("svg[aria-hidden='true'] circle"),
  ).map((circle) => circle.getAttribute("fill"));
  return [...new Set(fills)].filter(
    (fill) => fill === "#111111" || fill === "#222222",
  );
}

function hoverRow(container: HTMLElement, clientX: number) {
  // The transparent rect inside the translated plot group receives the mouse.
  const surface = container.querySelector("svg g[transform] > rect[fill='transparent']");
  if (!surface) {
    throw new Error("chart interaction surface not found");
  }
  fireEvent.mouseMove(surface, { clientX, clientY: 60 });
}

describe("ChartTooltip dots", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a dot for every series that has a value at the hovered row", async () => {
    const { container } = renderChart();

    // Default margin is 40, so the first day sits at x 40.
    await waitFor(() => {
      hoverRow(container, 40);
      expect(dotColors(container).sort()).toEqual(["#111111", "#222222"]);
    });
  });

  it("hides the dot of a series with no value at the hovered row", async () => {
    const { container } = renderChart();

    // 400 wide minus the 40px margins leaves 320 for 3 days: the middle day is at x 200.
    await waitFor(() => {
      hoverRow(container, 200);
      expect(dotColors(container)).toEqual(["#111111"]);
    });
  });
});
