import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Line } from "./line";
import { LineChart } from "./line-chart";
import { YAxis, type YAxisProps } from "./y-axis";

const rows = [
  { date: new Date("2026-10-25T00:00:00Z"), value: 0 },
  { date: new Date("2026-10-26T00:00:00Z"), value: 20 },
  { date: new Date("2026-10-27T00:00:00Z"), value: 40 },
];

function renderAxis(props: YAxisProps, data = rows) {
  return render(
    <LineChart animationDuration={0} aspectRatio="" data={data}>
      <Line animate={false} dataKey="value" showHighlight={false} />
      <YAxis {...props} />
    </LineChart>,
  );
}

describe("YAxis", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("labels the ticks with the given formatter", async () => {
    renderAxis({ formatValue: (value) => `${value} s` });

    await waitFor(() => {
      expect(screen.getAllByText(/^\d+ s$/).length).toBeGreaterThan(1);
    });
    expect(screen.getByText("40 s")).toBeInTheDocument();
  });

  it("abbreviates thousands unless asked not to", async () => {
    const big = rows.map((row, index) => ({ ...row, value: index * 1500 }));

    const { unmount } = renderAxis({}, big);
    await waitFor(() => {
      expect(screen.getAllByText(/k$/).length).toBeGreaterThan(0);
    });
    unmount();

    renderAxis({ formatLargeNumbers: false }, big);
    await waitFor(() => {
      expect(screen.getByText("3000")).toBeInTheDocument();
    });
    expect(screen.queryByText(/k$/)).not.toBeInTheDocument();
  });
});
