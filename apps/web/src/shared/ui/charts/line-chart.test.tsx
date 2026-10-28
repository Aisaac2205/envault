import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartLegendHoverProvider } from "./chart-legend-hover";
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
  describe("series halo", () => {
    function renderHalo(props: Record<string, unknown> = {}) {
      return render(
        <LineChart animationDuration={0} aspectRatio="2 / 1" data={data}>
          <Line
            animate={false}
            dataKey="value"
            fadeEdges={false}
            showHighlight={false}
            stroke="#ff0000"
            strokeWidth={2}
            {...props}
          />
        </LineChart>
      );
    }

    function strokes(container: HTMLElement) {
      return Array.from(container.querySelectorAll<SVGPathElement>("svg path"))
        .filter((path) => path.getAttribute("stroke-linecap"))
        .map((path) => ({
          stroke: path.getAttribute("stroke"),
          width: path.getAttribute("stroke-width"),
          dash: path.getAttribute("stroke-dasharray"),
          cap: path.getAttribute("stroke-linecap"),
        }));
    }

    it("draws nothing extra by default", async () => {
      const { container } = renderHalo();

      await waitFor(() => {
        expect(strokes(container)).toHaveLength(1);
      });
    });

    it("draws a wider stroke in the halo color behind the line, with the same dash pattern", async () => {
      const { container } = renderHalo({
        halo: { color: "#00ff00", extraWidth: 3 },
        strokeDasharray: "6 4",
        strokeLinecap: "butt",
      });

      await waitFor(() => {
        expect(strokes(container)).toEqual([
          { stroke: "#00ff00", width: "5", dash: "6 4", cap: "butt" },
          { stroke: "#ff0000", width: "2", dash: "6 4", cap: "butt" },
        ]);
      });
    });

    it("defaults the halo to 3px wider than the line and keeps the round cap", async () => {
      const { container } = renderHalo({ halo: { color: "#00ff00" } });

      await waitFor(() => {
        expect(strokes(container)).toEqual([
          { stroke: "#00ff00", width: "5", dash: null, cap: "round" },
          { stroke: "#ff0000", width: "2", dash: null, cap: "round" },
        ]);
      });
    });
  });

  describe("legend hover linking", () => {
    const twoSeries = data.map((row) => ({ ...row, other: row.value + 6 }));

    /** Opacity of the group that wraps a series; motion writes it as an SVG attribute. */
    function opacityOf(container: HTMLElement, stroke: string) {
      const group = container
        .querySelector<SVGPathElement>(`svg path[stroke="${stroke}"]`)
        ?.closest("g");
      return group ? Number(group.getAttribute("opacity") ?? 1) : null;
    }

    function renderLinked(hoveredIndex: number | null) {
      return render(
        <ChartLegendHoverProvider
          hoveredIndex={hoveredIndex}
          onHoverChange={() => undefined}
        >
          <LineChart animationDuration={0} aspectRatio="2 / 1" data={twoSeries}>
            <Line
              animate={false}
              dataKey="value"
              fadeEdges={false}
              highlight={{ dimOpacity: 0.25 }}
              showHighlight={false}
              stroke="#ff0000"
            />
            <Line
              animate={false}
              dataKey="other"
              fadeEdges={false}
              highlight={{ dimOpacity: 0.25 }}
              showHighlight={false}
              stroke="#0000ff"
            />
          </LineChart>
        </ChartLegendHoverProvider>
      );
    }

    it("dims the other series, even with the chart hover highlight off", async () => {
      const { container } = renderLinked(0);

      await waitFor(() => {
        expect(opacityOf(container, "#0000ff")).toBe(0.25);
      });
      expect(opacityOf(container, "#ff0000")).toBe(1);
    });

    it("leaves every series alone when nothing is highlighted", async () => {
      const { container } = renderLinked(null);

      await waitFor(() => {
        expect(opacityOf(container, "#0000ff")).not.toBeNull();
      });
      expect(opacityOf(container, "#0000ff")).toBe(1);
      expect(opacityOf(container, "#ff0000")).toBe(1);
    });
  });
});
