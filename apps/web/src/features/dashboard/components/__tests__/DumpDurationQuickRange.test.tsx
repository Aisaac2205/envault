import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DailyBackupPoint, DailyBackupSeries } from "../../types";
import { DumpDurationChart } from "../DumpDurationChart";

const analytics = vi.hoisted(() => ({ useDailyAnalytics: vi.fn() }));
const connections = vi.hoisted(() => ({ useConnections: vi.fn() }));

vi.mock("../../hooks/useDailyAnalytics", () => analytics);
vi.mock("@/features/connections/hooks/useConnections", () => connections);

/** `count` days ending on 2026-10-27, each a little slower than the one before. */
function lastDays(count: number): DailyBackupPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 9, 27 - (count - 1 - index))).toISOString().slice(0, 10),
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
    window: 30,
    from: days[0]!.date,
    to: days.at(-1)!.date,
    timezone: "UTC",
    connectionId: null,
    days,
  };
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
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
    connections.useConnections.mockReturnValue({ data: [], isLoading: false });
    analytics.useDailyAnalytics.mockReturnValue({
      data: series(lastDays(30)),
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

  it("asks the API for the window of the pressed button", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);
    expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(30, undefined);

    await user.click(within(quickRanges()).getByRole("button", { name: "7d" }));

    expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(7, undefined);
    expect(pressedLabels()).toEqual(["7d"]);

    await user.click(within(quickRanges()).getByRole("button", { name: "90d" }));

    expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(90, undefined);
    expect(pressedLabels()).toEqual(["90d"]);

    await user.click(within(quickRanges()).getByRole("button", { name: "30d" }));

    expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(30, undefined);
    expect(pressedLabels()).toEqual(["30d"]);
  });

  it("keeps the button pressed when it is selected again", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);
    const sevenDays = within(quickRanges()).getByRole("button", { name: "7d" });

    await user.click(sevenDays);
    await user.click(sevenDays);

    expect(pressedLabels()).toEqual(["7d"]);
    expect(analytics.useDailyAnalytics).toHaveBeenLastCalledWith(7, undefined);
  });

  it("shows every day the API answers with, not a slice of them", async () => {
    const user = userEvent.setup();
    render(<DumpDurationChart />);
    analytics.useDailyAnalytics.mockReturnValue({
      data: series(lastDays(7)),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    await user.click(within(quickRanges()).getByRole("button", { name: "7d" }));

    const summary = screen.getByRole("img").getAttribute("aria-label");
    // The whole answer: from 21 to 27 October, with no client side narrowing.
    expect(summary).toContain("21 de oct de 2026");
    expect(summary).toContain("27 de oct de 2026");
  });

  it("has no brush to drag any more", () => {
    render(<DumpDurationChart />);

    expect(
      screen.queryByRole("group", { name: "Selector de rango de fechas" }),
    ).not.toBeInTheDocument();
  });
});
