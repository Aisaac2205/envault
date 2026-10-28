import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bar } from "./bar";
import { BarChart } from "./bar-chart";
import { Grid } from "./grid";
import { YAxis } from "./y-axis";

const week = [
  { label: "Mon", completed: 2, failed: 1 },
  { label: "Tue", completed: 3, failed: 0 },
  { label: "Wed", completed: 1, failed: 0 },
];

/** The text of every y axis label (the class the axis gives its tick labels). */
function yAxisLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("span.text-chart-label")).map(
    (label) => label.textContent ?? "",
  );
}

describe("bklit BarChart", () => {
  beforeEach(() => {
    // jsdom has no layout; the chart reads its size from clientWidth/clientHeight.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("y axis", () => {
    it("labels the ticks of the bars' own scale, not the default 0 to 100", async () => {
      // envault: the chart did not publish its y domain, so the axis took ticks from
      // a default [0, 100] domain: 0, 20, ..., 100. Only 0 landed inside a small chart.
      const { container } = render(
        <BarChart
          animationDuration={0}
          aspectRatio=""
          className="h-[200px]"
          data={week}
          margin={{ top: 12, right: 12, bottom: 32, left: 36 }}
          stacked
          xDataKey="label"
        >
          <Grid horizontal numTicksRows={3} />
          <Bar dataKey="completed" />
          <Bar dataKey="failed" />
          <YAxis numTicks={3} />
        </BarChart>,
      );

      await waitFor(() => {
        expect(yAxisLabels(container).length).toBeGreaterThan(0);
      });
      // The tallest stack is 3: ticks 0 to 3, whole numbers.
      expect(yAxisLabels(container)).toEqual(["0", "1", "2", "3"]);
    });

    it("follows the data when it changes", async () => {
      const taller = week.map((row) => ({ ...row, completed: row.completed * 10 }));
      const chart = (data: typeof week) => (
        <BarChart
          animationDuration={0}
          aspectRatio=""
          className="h-[200px]"
          data={data}
          margin={{ top: 12, right: 12, bottom: 32, left: 36 }}
          stacked
          xDataKey="label"
        >
          <Bar dataKey="completed" />
          <Bar dataKey="failed" />
          <YAxis numTicks={3} />
        </BarChart>
      );
      const { container, rerender } = render(chart(week));
      await waitFor(() => {
        expect(yAxisLabels(container)).toEqual(["0", "1", "2", "3"]);
      });

      rerender(chart(taller));

      // The tallest stack is 30 now.
      await waitFor(() => {
        expect(yAxisLabels(container)).toEqual(["0", "10", "20", "30"]);
      });
    });
  });
});
