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
});
