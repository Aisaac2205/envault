import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChartBrushProps } from "@/shared/ui/charts/chart-brush";
import type { DailyBackupPoint, DailyBackupSeries } from "../../types";
import { DumpDurationChart } from "../DumpDurationChart";

const analytics = vi.hoisted(() => ({ useDailyAnalytics: vi.fn() }));
const connections = vi.hoisted(() => ({ useConnections: vi.fn() }));
const brush = vi.hoisted(() => ({
  mounts: 0,
  latest: null as null | {
    initialSelection?: { start: Date; end: Date } | null;
    onSelectionChange?: (selection: { start: Date; end: Date } | null) => void;
  },
}));

vi.mock("../../hooks/useDailyAnalytics", () => analytics);
vi.mock("@/features/connections/hooks/useConnections", () => connections);
// The real brush needs a layout to drag. The stub keeps what the card passes it,
// and counts mounts, because a preset has to remount the brush to move it.
vi.mock("@/shared/ui/charts/chart-brush", async () => {
  const { useEffect } = await import("react");
  return {
    ChartBrush: function ChartBrushStub(props: ChartBrushProps) {
      brush.latest = props;
      useEffect(() => {
        brush.mounts += 1;
      }, []);
      return <g data-testid="brush-stub" />;
    },
  };
});

function ninetyDays(): DailyBackupPoint[] {
  return Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10),
    completed: 1,
    failed: 0,
    p50DurationSeconds: 1 + index * 0.1,
    p95DurationSeconds: 2 + index * 0.1,
    maxDurationSeconds: 3 + index * 0.1,
    totalSizeMb: 0,
  }));
}

function series(days: DailyBackupPoint[]): DailyBackupSeries {
  return {
    window: 90,
    from: days[0]!.date,
    to: days.at(-1)!.date,
    timezone: "UTC",
    connectionId: null,
    days,
  };
}

/** Local midnight of day `index` of the window, which is how the chart parses a day. */
function localDay(index: number): Date {
  return new Date(2026, 7, 1 + index);
}

function quickRanges() {
  return screen.getByRole("group", { name: "Rango rápido" });
}

function pressedLabels() {
  return within(quickRanges())
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);
}

describe("DumpDurationChart quick ranges", () => {
  beforeEach(() => {
    brush.mounts = 0;
    brush.latest = null;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
    connections.useConnections.mockReturnValue({ data: [], isLoading: false });
    analytics.useDailyAnalytics.mockReturnValue({
      data: series(ninetyDays()),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("offers 7d, 30d and 90d as toggle buttons, with 30d pressed by default", () => {
    render(<DumpDurationChart />);

    const buttons = within(quickRanges()).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["7d", "30d", "90d"]);
    expect(pressedLabels()).toEqual(["30d"]);
  });

  it("shows the last 7 days when 7d is selected", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);

    await user.click(within(quickRanges()).getByRole("button", { name: "7d" }));

    expect(pressedLabels()).toEqual(["7d"]);
    // Day 83 to day 89 of the window.
    expect(brush.latest?.initialSelection).toEqual({
      start: localDay(83),
      end: localDay(89),
    });
    const summary = screen.getByRole("img").getAttribute("aria-label");
    expect(summary).toContain("23 de oct de 2026");
    expect(summary).toContain("29 de oct de 2026");
  });

  it("shows the whole window when 90d is selected", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);

    await user.click(within(quickRanges()).getByRole("button", { name: "90d" }));

    expect(pressedLabels()).toEqual(["90d"]);
    expect(brush.latest?.initialSelection).toEqual({
      start: localDay(0),
      end: localDay(89),
    });
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("1 de ago de 2026");
  });

  it("keeps the preset pressed when it is selected again", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);
    const sevenDays = within(quickRanges()).getByRole("button", { name: "7d" });

    await user.click(sevenDays);
    await user.click(sevenDays);

    expect(pressedLabels()).toEqual(["7d"]);
  });

  it("clears the pressed state when the brush is dragged to another range", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);
    await user.click(within(quickRanges()).getByRole("button", { name: "7d" }));
    expect(pressedLabels()).toEqual(["7d"]);

    act(() => {
      brush.latest?.onSelectionChange?.({ start: localDay(70), end: localDay(85) });
    });

    await waitFor(() => {
      expect(pressedLabels()).toEqual([]);
    });
  });

  it("presses a preset again when the brush lands on the same days", async () => {
    render(<DumpDurationChart />);

    act(() => {
      // Edges a few hours into the day, as a dragged handle would leave them.
      brush.latest?.onSelectionChange?.({
        start: new Date(localDay(60).getTime() - 3 * 60 * 60 * 1000),
        end: new Date(localDay(89).getTime() + 4 * 60 * 60 * 1000),
      });
    });

    await waitFor(() => {
      expect(pressedLabels()).toEqual(["30d"]);
    });
  });

  it("remounts the brush for a preset, but not while it is being dragged", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);
    const afterFirstRender = brush.mounts;

    // A drag reports a new range on every move; remounting would drop the grip.
    act(() => {
      brush.latest?.onSelectionChange?.({ start: localDay(70), end: localDay(85) });
    });
    expect(brush.mounts).toBe(afterFirstRender);

    // The brush keeps its own position after the first render, so a preset has to
    // remount it to move the selection window.
    await user.click(within(quickRanges()).getByRole("button", { name: "7d" }));
    expect(brush.mounts).toBe(afterFirstRender + 1);
  });
});
