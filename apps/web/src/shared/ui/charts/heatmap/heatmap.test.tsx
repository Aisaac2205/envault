import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HeatmapColumn,
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionProvider,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
} from "./index";

const WIDTH = 480;
const MARGIN = { top: 24, right: 8, left: 36, bottom: 0 };

/** jsdom has no ResizeObserver; the chart is sized from the first notification. */
class FixedWidthObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: WIDTH, height: 0, top: 0, left: 0 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

/** `weeks` Monday-first columns of seven days from `start`; the first `skip` and the last `tail` slots are hidden. */
function grid(start: Date, weeks: number, skip = 0, count = 1, tail = 0): HeatmapColumn[] {
  return Array.from({ length: weeks }, (_, column) => ({
    bin: column,
    bins: Array.from({ length: 7 }, (_, row) => {
      const slot = column * 7 + row;
      return {
        bin: row,
        count,
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + slot),
        hidden: slot < skip || slot >= weeks * 7 - tail || undefined,
      };
    }),
  }));
}

function renderHeatmap(data: HeatmapColumn[], children: React.ReactNode) {
  return render(
    <HeatmapInteractionProvider>
      <HeatmapChart animate={false} data={data} gap={2} layout="fluid" margin={MARGIN}>
        {children}
      </HeatmapChart>
    </HeatmapInteractionProvider>,
  );
}

function dataRects(container: HTMLElement) {
  // Each cell is two rects (the data and a loading overlay); the data one comes first.
  return Array.from(container.querySelectorAll<SVGRectElement>("rect.visx-heatmap-rect")).filter(
    (_, index) => index % 2 === 0,
  );
}

function XAxisProbe() {
  return <HeatmapXAxis />;
}

describe("vendored bklit heatmap", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FixedWidthObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("hidden days", () => {
    it("draws no cell for a hidden slot and keeps the others in place", async () => {
      // Wednesday 2026-10-07 is the third row: two hidden slots lead the first week.
      const data = grid(new Date(2026, 9, 5), 2, 2);

      const { container } = renderHeatmap(data, <HeatmapCells hideGhostCells={false} />);

      await waitFor(() => expect(dataRects(container)).toHaveLength(14 - 2));
      const rects = dataRects(container);
      const y = (index: number) => Number(rects[index]?.getAttribute("y"));
      // The first drawn cell is the third row of the first column: two rows below the
      // first row of the next column, which is the sixth cell drawn.
      const pitch = y(1) - y(0);
      expect(y(5)).toBeLessThan(y(0));
      expect(y(0)).toBeCloseTo(y(5) + 2 * pitch, 0);
    });

    it("draws every slot when none is hidden", async () => {
      const { container } = renderHeatmap(grid(new Date(2026, 9, 5), 2), <HeatmapCells hideGhostCells={false} />);

      await waitFor(() => expect(dataRects(container)).toHaveLength(14));
    });
  });

  describe("month labels", () => {
    // Monday 2026-07-20: the first week is July, the second holds August 1st. Twelve
    // weeks share 436 px, so two neighbouring columns are 36 px apart.
    const data = grid(new Date(2026, 6, 20), 12);

    it("writes the month names in the language it is given", async () => {
      renderHeatmap(data, <HeatmapXAxis locale="es-AR" />);

      expect(await screen.findByText("ago")).toBeInTheDocument();
      expect(screen.queryByText("Aug")).not.toBeInTheDocument();
    });

    it("keeps the English names by default", async () => {
      renderHeatmap(data, <HeatmapXAxis />);

      expect(await screen.findByText("Aug")).toBeInTheDocument();
      expect(screen.getByText("Jul")).toBeInTheDocument();
    });

    it("drops the earlier of two labels that sit closer than the gap", async () => {
      renderHeatmap(data, <HeatmapXAxis locale="en-US" minLabelGap={64} />);

      expect(await screen.findByText("Aug")).toBeInTheDocument();
      expect(screen.queryByText("Jul")).not.toBeInTheDocument();
    });
  });

  describe("month labels and hidden days", () => {
    it("does not name a month after a day that is hidden", async () => {
      // Monday 2026-10-19 for two weeks: November 1st closes the last week, but it is hidden.
      const data = grid(new Date(2026, 9, 19), 2, 0, 1, 5);

      renderHeatmap(data, <XAxisProbe />);

      expect(await screen.findByText("Oct")).toBeInTheDocument();
      expect(screen.queryByText("Nov")).not.toBeInTheDocument();
    });

    it("names the month of the first visible day when the first week starts in the month before", async () => {
      // Monday 2026-07-27: July 27 to 29 are hidden, July 30 and 31 and August 1st are shown.
      const data = grid(new Date(2026, 6, 27), 3, 3);

      renderHeatmap(data, <XAxisProbe />);

      expect(await screen.findByText("Aug")).toBeInTheDocument();
      expect(screen.queryByText("Jul")).not.toBeInTheDocument();
    });
  });

  describe("weekday labels", () => {
    it("shows the labels it is given, for the rows they name", async () => {
      renderHeatmap(
        grid(new Date(2026, 9, 5), 2),
        <HeatmapYAxis labels={["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]} tickFilter="even" />,
      );

      expect(await screen.findByText("lun")).toBeInTheDocument();
      expect(screen.getByText("mié")).toBeInTheDocument();
      expect(screen.getByText("vie")).toBeInTheDocument();
      expect(screen.getByText("dom")).toBeInTheDocument();
      expect(screen.queryByText("mar")).not.toBeInTheDocument();
      expect(screen.queryByText("Mon")).not.toBeInTheDocument();
    });
  });

  describe("tooltip", () => {
    it("shows the header and the line the caller builds, as nodes", async () => {
      const data = grid(new Date(2026, 9, 5), 2, 0, 3);
      const { container } = renderHeatmap(
        data,
        <>
          <HeatmapCells hideGhostCells={false} />
          <HeatmapTooltip
            formatHeader={(date) => <span>header {date.getDate()}</span>}
            formatLabel={(count) => <b data-testid="line">level {count}</b>}
            instant
          />
        </>,
      );

      await waitFor(() => expect(dataRects(container).length).toBeGreaterThan(0));
      fireEvent.pointerEnter(dataRects(container)[0]!);

      expect(await screen.findByText("header 5")).toBeInTheDocument();
      expect(screen.getByTestId("line")).toHaveTextContent("level 3");
    });

    it("keeps the English date header when none is given", async () => {
      const { container } = renderHeatmap(
        grid(new Date(2026, 9, 5), 2, 0, 3),
        <>
          <HeatmapCells hideGhostCells={false} />
          <HeatmapTooltip instant />
        </>,
      );

      await waitFor(() => expect(dataRects(container).length).toBeGreaterThan(0));
      fireEvent.pointerEnter(dataRects(container)[0]!);

      expect(await screen.findByText("October 5th 2026")).toBeInTheDocument();
      expect(screen.getByText("3 contributions")).toBeInTheDocument();
    });
  });
});
