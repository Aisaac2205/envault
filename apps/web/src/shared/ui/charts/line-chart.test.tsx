import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Grid } from "./grid";
import { Line } from "./line";
import { LineChart } from "./line-chart";

const data = [
  { date: new Date("2026-10-26T00:00:00Z"), value: 12 },
  { date: new Date("2026-10-27T00:00:00Z"), value: 20 },
];

describe("bklit LineChart", () => {
  beforeEach(() => {
    // jsdom has no layout, so the chart measures 0x0 and draws nothing. The
    // chart reads its size from clientWidth/clientHeight when CSS gives none.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a two point series without crashing", async () => {
    const { container } = render(
      <LineChart data={data} aspectRatio="2 / 1">
        <Grid horizontal />
        <Line dataKey="value" />
      </LineChart>,
    );

    await waitFor(() => {
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.querySelector("svg path")).not.toBeNull();
    });
  });

  describe("series with missing values", () => {
    const gapData = [
      { date: new Date("2026-10-20T00:00:00Z"), value: 10 },
      { date: new Date("2026-10-21T00:00:00Z"), value: 14 },
      { date: new Date("2026-10-22T00:00:00Z"), value: null },
      { date: new Date("2026-10-23T00:00:00Z"), value: 18 },
      { date: new Date("2026-10-24T00:00:00Z"), value: 22 },
    ];

    function renderGapChart(strokeDasharray?: string) {
      return render(
        <LineChart animationDuration={0} aspectRatio="2 / 1" data={gapData}>
          <Line
            animate={false}
            dataKey="value"
            fadeEdges={false}
            showHighlight={false}
            strokeDasharray={strokeDasharray}
          />
        </LineChart>
      );
    }

    function seriesPath(container: HTMLElement) {
      return container.querySelector<SVGPathElement>(
        "svg path[stroke-linecap='round']"
      );
    }

    it("breaks the line instead of dropping to zero", async () => {
      const { container } = renderGapChart();

      await waitFor(() => {
        const d = seriesPath(container)?.getAttribute("d") ?? "";
        expect((d.match(/M/g) ?? []).length).toBe(2);
      });
    });

    it("applies the dash pattern to the series stroke", async () => {
      const { container } = renderGapChart("6 4");

      await waitFor(() => {
        expect(seriesPath(container)?.getAttribute("stroke-dasharray")).toBe(
          "6 4"
        );
      });
    });
  });
});
