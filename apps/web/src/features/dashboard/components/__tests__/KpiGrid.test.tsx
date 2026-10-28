import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConnectionsHealth, DailyBackupPoint, DailyBackupSeries, RestoreJob } from "../../types";
import { KpiGrid } from "../KpiGrid";
import { useEnglishLocale } from "./english-locale";

const hooks = vi.hoisted(() => ({
  useConnectionsHealth: vi.fn(),
  useDailyAnalytics: vi.fn(),
}));
vi.mock("../../hooks/useConnectionsHealth", () => ({ useConnectionsHealth: hooks.useConnectionsHealth }));
vi.mock("../../hooks/useDailyAnalytics", () => ({ useDailyAnalytics: hooks.useDailyAnalytics }));

type PlotProps = {
  kind: "area" | "bar";
  series: { date: string; value: number | null }[];
  color: string;
  onHoverChange: (index: number | null) => void;
};

// The plot itself is covered by KpiSparkline.test.tsx: here it is a stand-in that
// records what it was given and lets a test point at a day.
const plots = vi.hoisted(() => ({ byKey: new Map<string, unknown>() }));
vi.mock("../kpis/KpiSparkline", () => ({
  KpiSparkline: (props: PlotProps) => {
    plots.byKey.set(`${props.kind}:${props.color}`, props);
    return <div data-testid={`plot-${props.kind}`} />;
  },
}));

function plot(key: string): PlotProps {
  const found = plots.byKey.get(key) as PlotProps | undefined;
  if (!found) throw new Error(`no plot drawn for ${key}`);
  return found;
}

function day(date: string, over: Partial<DailyBackupPoint> = {}): DailyBackupPoint {
  return {
    date,
    completed: 0,
    failed: 0,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    maxDurationSeconds: null,
    totalSizeMb: 0,
    ...over,
  };
}

/** 30 UTC days ending 2026-10-27 (index 29), with the days you fill in. */
function month(fill: (index: number) => Partial<DailyBackupPoint> = () => ({})): DailyBackupSeries {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 27 - (29 - index))).toISOString().slice(0, 10);
    return day(date, fill(index));
  });
  return { window: 30, from: days[0]!.date, to: "2026-10-27", timezone: "UTC", connectionId: null, days };
}

const HEALTH: ConnectionsHealth = {
  window: 30,
  from: "2026-09-28",
  to: "2026-10-27",
  timezone: "UTC",
  overall: {
    completed: 1203,
    failed: 31,
    successRate: 0.9749,
    p50DurationSeconds: 4.2,
    p95DurationSeconds: 12.4,
  },
  connections: [],
};

function restore(over: Partial<RestoreJob> = {}): RestoreJob {
  return {
    id: "r-1",
    targetConnectionId: "conn-dev",
    targetEnvironment: "dev",
    isDryRun: false,
    status: "completed",
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...over,
  };
}

function query<T>(over: Record<string, unknown> = {}) {
  return { data: undefined as T | undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over };
}

function mockQueries(
  health: ReturnType<typeof query<ConnectionsHealth>>,
  daily: ReturnType<typeof query<DailyBackupSeries>>,
) {
  hooks.useConnectionsHealth.mockReturnValue(health);
  hooks.useDailyAnalytics.mockReturnValue(daily);
}

function kpi(label: string) {
  return screen.getByRole("group", { name: label });
}

/** The headline figure: the first paragraph of the group. */
function figure(label: string) {
  return within(kpi(label)).getAllByRole("paragraph")[0]!;
}

describe("KpiGrid", () => {
  useEnglishLocale();

  beforeEach(() => {
    plots.byKey.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is four labelled groups: success rate, backups, p95 duration and the last restore", () => {
    mockQueries(query({ data: HEALTH }), query({ data: month() }));

    render(<KpiGrid restoresLoading={false} restores={[restore()]} />);

    expect(screen.getAllByRole("group")).toHaveLength(4);
    for (const label of ["Success rate (30d)", "Backups last 7 days", "p95 duration (30d)", "Last restore"]) {
      expect(kpi(label)).toBeInTheDocument();
    }
    // The two KPIs the charts made redundant are gone.
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Active connections")).not.toBeInTheDocument();
  });

  it("asks for the 30 day window, the one the charts open on, so no extra query is made", () => {
    mockQueries(query({ data: HEALTH }), query({ data: month() }));

    render(<KpiGrid restoresLoading={false} restores={[]} />);

    expect(hooks.useConnectionsHealth).toHaveBeenCalledWith(30);
    expect(hooks.useDailyAnalytics).toHaveBeenCalledWith(30);
  });

  describe("success rate", () => {
    it("shows the window's rate from the health answer and how many backups it is made of", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate (30d)")).toHaveTextContent("97.4%");
      expect(kpi("Success rate (30d)")).toHaveTextContent("1,203 of 1,234 backups completed");
    });

    it("draws the daily rate with a gap on the days without finished backups", () => {
      const series = month((index) => (index === 29 ? { completed: 9, failed: 1 } : index === 28 ? { failed: 2 } : {}));
      mockQueries(query({ data: HEALTH }), query({ data: series }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      const { series: drawn } = plot("area:var(--chart-1)");
      expect(drawn).toHaveLength(30);
      expect(drawn.at(-1)).toEqual({ date: "2026-10-27", value: 0.9 });
      expect(drawn.at(-2)).toEqual({ date: "2026-10-26", value: 0 });
      expect(drawn[0]?.value).toBeNull();
    });

    it("has a dash and a note when nothing finished in the window", () => {
      const empty = { completed: 0, failed: 0, successRate: null, p50DurationSeconds: null, p95DurationSeconds: null };
      mockQueries(query({ data: { ...HEALTH, overall: empty } }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate (30d)")).toHaveTextContent("—");
      expect(kpi("Success rate (30d)")).toHaveTextContent("No backups in this period");
      expect(figure("p95 duration (30d)")).toHaveTextContent("—");
    });

    it("swaps the caption for the day under the pointer, and puts it back when the pointer leaves", () => {
      // Index 27 is 2026-10-25.
      const series = month((index) => (index === 27 ? { completed: 24, failed: 1 } : {}));
      mockQueries(query({ data: HEALTH }), query({ data: series }));
      render(<KpiGrid restoresLoading={false} restores={[]} />);
      const { onHoverChange } = plot("area:var(--chart-1)");

      act(() => onHoverChange(27));
      expect(kpi("Success rate (30d)")).toHaveTextContent("Oct 25 · 96%");

      act(() => onHoverChange(3));
      expect(kpi("Success rate (30d)")).toHaveTextContent("Oct 1 · no backups");

      act(() => onHoverChange(null));
      expect(kpi("Success rate (30d)")).toHaveTextContent("1,203 of 1,234 backups completed");
    });
  });

  describe("backups in the last 7 days", () => {
    it("adds up the completed backups of the last 7 calendar days only", () => {
      // 100 completed on each of the 23 earlier days must not leak into the week.
      const series = month((index) => (index < 23 ? { completed: 100 } : { completed: index - 22 }));
      mockQueries(query({ data: HEALTH }), query({ data: series }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      // Days 23 to 29 complete 1 to 7 backups.
      expect(figure("Backups last 7 days")).toHaveTextContent("28");
      const { series: drawn } = plot("bar:var(--chart-3)");
      expect(drawn.map((point) => point.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(drawn[0]?.date).toBe("2026-10-21");
      expect(drawn.at(-1)?.date).toBe("2026-10-27");
    });

    it("counts a quiet day as zero instead of reaching back to older busy days", () => {
      const sparse: DailyBackupSeries = {
        window: 30,
        from: "2026-08-23",
        to: "2026-10-27",
        timezone: "UTC",
        connectionId: null,
        days: [day("2026-08-23", { completed: 50 }), day("2026-10-26", { completed: 3 })],
      };
      mockQueries(query({ data: HEALTH }), query({ data: sparse }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Backups last 7 days")).toHaveTextContent("3");
      expect(plot("bar:var(--chart-3)").series.map((point) => point.value)).toEqual([0, 0, 0, 0, 0, 3, 0]);
    });

    it("reads the day under the pointer as a count", () => {
      mockQueries(
        query({ data: HEALTH }),
        query({ data: month((index) => (index === 29 ? { completed: 12 } : index === 28 ? { completed: 1 } : {})) }),
      );
      render(<KpiGrid restoresLoading={false} restores={[]} />);
      const { onHoverChange } = plot("bar:var(--chart-3)");

      act(() => onHoverChange(6));
      expect(kpi("Backups last 7 days")).toHaveTextContent("Oct 27 · 12 backups");

      act(() => onHoverChange(5));
      expect(kpi("Backups last 7 days")).toHaveTextContent("Oct 26 · 1 backup");
    });
  });

  describe("p95 duration", () => {
    it("shows the window's 95th percentile and its median, and draws the daily p95 with gaps", () => {
      const series = month((index) => (index === 29 ? { completed: 5, p95DurationSeconds: 9.5 } : {}));
      mockQueries(query({ data: HEALTH }), query({ data: series }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("p95 duration (30d)")).toHaveTextContent("12.4 s");
      expect(kpi("p95 duration (30d)")).toHaveTextContent("Median 4.2 s");
      const { series: drawn } = plot("area:var(--chart-duration-p95)");
      expect(drawn.at(-1)?.value).toBe(9.5);
      expect(drawn[0]?.value).toBeNull();
    });

    it("never colors a sparkline with a status color", () => {
      mockQueries(
        query({ data: HEALTH }),
        query({ data: month((index) => (index === 29 ? { completed: 5, p95DurationSeconds: 9.5 } : {})) }),
      );

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      const colors = [...plots.byKey.values()].map((props) => (props as PlotProps).color);
      expect(colors).toHaveLength(3);
      for (const color of colors) {
        expect(color).not.toMatch(/--color-(success|warning|error|info)/);
      }
    });
  });

  describe("last restore", () => {
    it("shows the newest restore: status with icon and label, when it ran and the target", () => {
      const restores = [
        restore({ id: "old", status: "failed", createdAt: new Date(Date.now() - 48 * 3_600_000).toISOString() }),
        restore({ id: "new", status: "completed", isDryRun: false }),
      ];
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={restores} />);

      const group = kpi("Last restore");
      expect(figure("Last restore")).toHaveTextContent("Completed");
      expect(figure("Last restore").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(group).toHaveTextContent("2 hours ago");
      expect(group).toHaveTextContent("Real restore");
      expect(group).toHaveTextContent("Target: Development");
    });

    it("tells a dry run from a real restore", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[restore({ isDryRun: true, status: "failed" })]} />);

      expect(figure("Last restore")).toHaveTextContent("Failed");
      expect(kpi("Last restore")).toHaveTextContent("Dry run");
      expect(kpi("Last restore")).not.toHaveTextContent("Real restore");
    });

    it("has a no-data state when no restore ever ran", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Last restore")).toHaveTextContent("—");
      expect(kpi("Last restore")).toHaveTextContent("No restores yet");
    });

    it("is busy while the restores load", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading restores={[]} />);

      expect(kpi("Last restore")).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("states", () => {
    it("is busy while the health answer and the daily series load", () => {
      mockQueries(query({ isLoading: true }), query({ isLoading: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      for (const label of ["Success rate (30d)", "Backups last 7 days", "p95 duration (30d)"]) {
        expect(kpi(label)).toHaveAttribute("aria-busy", "true");
      }
    });

    it("says it could not load a figure and retries that query on request", async () => {
      const health = query<ConnectionsHealth>({ isError: true, error: new Error("boom") });
      mockQueries(health, query({ data: month() }));
      const user = userEvent.setup();

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      const group = kpi("Success rate (30d)");
      expect(figure("Success rate (30d)")).toHaveTextContent("—");
      expect(group).toHaveTextContent("Could not load");
      await user.click(within(group).getByRole("button", { name: "Retry" }));
      expect(health.refetch).toHaveBeenCalledTimes(1);
      // The p95 card reads the same answer, so it fails with it; the backups card does not.
      expect(kpi("p95 duration (30d)")).toHaveTextContent("Could not load");
      expect(kpi("Backups last 7 days")).not.toHaveTextContent("Could not load");
    });

    it("keeps the figures it has when a later refetch fails", () => {
      mockQueries(query({ data: HEALTH, isError: true }), query({ data: month(), isError: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate (30d)")).toHaveTextContent("97.4%");
      expect(kpi("Success rate (30d)")).not.toHaveTextContent("Could not load");
    });

    it("still shows the figure when only the daily series is missing, with a baseline in place of the plot", () => {
      mockQueries(query({ data: HEALTH }), query({ isError: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate (30d)")).toHaveTextContent("97.4%");
      expect(plots.byKey.size).toBe(0);
    });
  });
});
