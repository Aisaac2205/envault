import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/i18n";
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
  series: { date: string; value: number | null }[];
  color: string;
  onHoverChange: (index: number | null) => void;
};

// The plot itself is covered by KpiSparkline.test.tsx: here it is a stand-in that
// records what it was given and lets a test point at a day.
const plots = vi.hoisted(() => ({ byKey: new Map<string, unknown>() }));
vi.mock("../kpis/KpiSparkline", () => ({
  KpiSparkline: (props: PlotProps) => {
    plots.byKey.set(`bar:${props.color}`, props);
    return <div data-testid="plot-bar" />;
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

/** The 90 day answer the 30 day figures are compared with: a slightly lower rate and a faster p95. */
const BASELINE: ConnectionsHealth = {
  ...HEALTH,
  window: 90,
  overall: {
    completed: 3500,
    failed: 136,
    successRate: 0.9625,
    p50DurationSeconds: 4,
    p95DurationSeconds: 10,
  },
};

function withOverall(base: ConnectionsHealth, overall: Partial<ConnectionsHealth["overall"]>): ConnectionsHealth {
  return { ...base, overall: { ...base.overall, ...overall } };
}

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
  baseline: ReturnType<typeof query<ConnectionsHealth>> = query({ data: BASELINE }),
) {
  // The 30 day figures and the 90 day baseline are two queries of the same hook.
  hooks.useConnectionsHealth.mockImplementation((window: number) => (window === 90 ? baseline : health));
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
    for (const label of ["Success rate last 30 days", "Backups last 7 days", "p95 duration last 30 days", "Last restore"]) {
      expect(kpi(label)).toBeInTheDocument();
    }
    // The two KPIs the charts made redundant are gone.
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Active connections")).not.toBeInTheDocument();
  });

  it("shows each window as a chip beside the title, never in brackets, and keeps it in the card's name", () => {
    mockQueries(query({ data: HEALTH }), query({ data: month() }));

    render(<KpiGrid restoresLoading={false} restores={[restore()]} />);

    const cards = [
      { name: "Success rate last 30 days", title: "Success rate", chip: "30d" },
      { name: "Backups last 7 days", title: "Backups", chip: "7d" },
      { name: "p95 duration last 30 days", title: "p95 duration", chip: "30d" },
    ];
    for (const { name, title, chip } of cards) {
      const heading = within(kpi(name)).getByRole("heading", { level: 3 });
      expect(heading).toHaveAccessibleName(name);
      expect(heading.textContent?.startsWith(`${title} `)).toBe(true);
      expect(heading.textContent).not.toMatch(/[()]/);
      // The chip is for the eye; assistive technology hears the spelled-out window instead.
      expect(within(heading).getByText(chip)).toHaveAttribute("aria-hidden", "true");
    }
    // The last restore has no window to show.
    expect(within(kpi("Last restore")).getByRole("heading", { level: 3 }).textContent).toBe("Last restore");
  });

  it("spells the window out in Spanish too", async () => {
    mockQueries(query({ data: HEALTH }), query({ data: month() }));
    await act(() => i18n.changeLanguage("es"));

    render(<KpiGrid restoresLoading={false} restores={[]} />);

    for (const name of ["Tasa de éxito últimos 30 días", "Respaldos últimos 7 días", "Duración p95 últimos 30 días"]) {
      expect(kpi(name)).toBeInTheDocument();
    }
  });

  it("asks for the 30 day window, the one the charts open on, and for the 90 day one to compare with", () => {
    mockQueries(query({ data: HEALTH }), query({ data: month() }));

    render(<KpiGrid restoresLoading={false} restores={[]} />);

    expect(hooks.useConnectionsHealth).toHaveBeenCalledWith(30);
    expect(hooks.useConnectionsHealth).toHaveBeenCalledWith(90);
    expect(hooks.useDailyAnalytics).toHaveBeenCalledWith(30);
  });

  it("draws one sparkline only, the 7 day bars: the charts below already draw the other series", () => {
    mockQueries(query({ data: HEALTH }), query({ data: month((index) => (index === 29 ? { completed: 5, p95DurationSeconds: 9.5 } : {})) }));

    render(<KpiGrid restoresLoading={false} restores={[]} />);

    expect([...plots.byKey.keys()]).toEqual(["bar:var(--chart-3)"]);
    for (const color of [...plots.byKey.values()].map((props) => (props as PlotProps).color)) {
      expect(color).not.toMatch(/--color-(success|warning|error|info)/);
    }
  });

  describe("success rate", () => {
    it("shows the window's rate from the health answer and how many backups it is made of", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate last 30 days")).toHaveTextContent("97.4%");
      expect(kpi("Success rate last 30 days")).toHaveTextContent("1,203 of 1,234 backups completed");
    });

    it("compares it with the 90 day rate, in points, with a word as well as an arrow", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      const group = kpi("Success rate last 30 days");
      // 97.49% against 96.25% is 1.24 points up; the baseline is written the way every rate is.
      expect(group).toHaveTextContent("Higher: +1.2 pts");
      expect(group).toHaveTextContent("vs 90d: 96.2%");
      expect(group.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    });

    it("reads a drop as lower and no move as unchanged", () => {
      mockQueries(
        query({ data: withOverall(HEALTH, { successRate: 0.9 }) }),
        query({ data: month() }),
      );
      const { unmount } = render(<KpiGrid restoresLoading={false} restores={[]} />);
      expect(kpi("Success rate last 30 days")).toHaveTextContent("Lower: -6.3 pts");
      unmount();

      mockQueries(
        query({ data: withOverall(HEALTH, { successRate: 0.9625 }) }),
        query({ data: month() }),
      );
      render(<KpiGrid restoresLoading={false} restores={[]} />);
      expect(kpi("Success rate last 30 days")).toHaveTextContent("Unchanged: 0.0 pts");
    });

    it("has a dash and a note when nothing finished in the window, and nothing to compare", () => {
      const empty = { completed: 0, failed: 0, successRate: null, p50DurationSeconds: null, p95DurationSeconds: null };
      mockQueries(query({ data: { ...HEALTH, overall: empty } }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate last 30 days")).toHaveTextContent("—");
      expect(kpi("Success rate last 30 days")).toHaveTextContent("No backups in this period");
      expect(kpi("Success rate last 30 days")).toHaveTextContent("No 90d baseline yet");
      expect(figure("p95 duration last 30 days")).toHaveTextContent("—");
    });

    it("holds the row for the comparison while the 90 day answer loads, and keeps the figure", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }), query({ isLoading: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate last 30 days")).toHaveTextContent("97.4%");
      expect(within(kpi("Success rate last 30 days")).getByTestId("kpi-delta-skeleton")).toBeInTheDocument();
      expect(within(kpi("p95 duration last 30 days")).getByTestId("kpi-delta-skeleton")).toBeInTheDocument();
    });

    it("keeps the figure and says there is no baseline when the 90 day answer fails", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }), query({ isError: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate last 30 days")).toHaveTextContent("97.4%");
      expect(kpi("Success rate last 30 days")).toHaveTextContent("No 90d baseline yet");
      expect(kpi("Success rate last 30 days")).not.toHaveTextContent("Could not load");
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

    it("compares it with the 7 calendar days before, not with the last rows of the series", () => {
      // The week before (index 16 to 22) completes 2 a day; the week itself, 4 a day.
      const series = month((index) => (index >= 23 ? { completed: 4 } : index >= 16 ? { completed: 2 } : { completed: 90 }));
      mockQueries(query({ data: HEALTH }), query({ data: series }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Backups last 7 days")).toHaveTextContent("28");
      const group = kpi("Backups last 7 days");
      expect(group).toHaveTextContent("Higher: +14");
      expect(group).toHaveTextContent("vs 14 in the 7d before");
    });

    it("reads a quieter week as lower", () => {
      const series = month((index) => (index >= 23 ? { completed: 1 } : index >= 16 ? { completed: 3 } : {}));
      mockQueries(query({ data: HEALTH }), query({ data: series }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(kpi("Backups last 7 days")).toHaveTextContent("Lower: -14");
      expect(kpi("Backups last 7 days")).toHaveTextContent("vs 21 in the 7d before");
    });

    it("swaps the comparison for the day under the pointer, and puts it back when the pointer leaves", () => {
      const series = month((index) => (index === 29 ? { completed: 12 } : index === 28 ? { completed: 1 } : {}));
      mockQueries(query({ data: HEALTH }), query({ data: series }));
      render(<KpiGrid restoresLoading={false} restores={[]} />);
      const { onHoverChange } = plot("bar:var(--chart-3)");

      act(() => onHoverChange(6));
      expect(kpi("Backups last 7 days")).toHaveTextContent("Oct 27 · 12 backups");
      expect(kpi("Backups last 7 days")).not.toHaveTextContent("in the 7d before");

      act(() => onHoverChange(5));
      expect(kpi("Backups last 7 days")).toHaveTextContent("Oct 26 · 1 backup");

      act(() => onHoverChange(null));
      expect(kpi("Backups last 7 days")).toHaveTextContent("vs 0 in the 7d before");
    });
  });

  describe("p95 duration", () => {
    it("shows the window's 95th percentile and its median", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("p95 duration last 30 days")).toHaveTextContent("12.4 s");
      expect(kpi("p95 duration last 30 days")).toHaveTextContent("Median 4.2 s");
    });

    it("compares it with the 90 day p95, as a share of it", () => {
      mockQueries(query({ data: HEALTH }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      // 12.4 s against 10 s is 24% slower.
      expect(kpi("p95 duration last 30 days")).toHaveTextContent("Higher: +24%");
      expect(kpi("p95 duration last 30 days")).toHaveTextContent("vs 90d: 10.0 s");
    });

    it("reads a faster month as lower", () => {
      mockQueries(query({ data: withOverall(HEALTH, { p95DurationSeconds: 7.5 }) }), query({ data: month() }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(kpi("p95 duration last 30 days")).toHaveTextContent("Lower: -25%");
    });

    it("has nothing to compare when the 90 day window has no p95", () => {
      mockQueries(
        query({ data: HEALTH }),
        query({ data: month() }),
        query({ data: withOverall(BASELINE, { p95DurationSeconds: null }) }),
      );

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("p95 duration last 30 days")).toHaveTextContent("12.4 s");
      expect(kpi("p95 duration last 30 days")).toHaveTextContent("No 90d baseline yet");
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
      mockQueries(query({ isLoading: true }), query({ isLoading: true }), query({ isLoading: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      for (const label of ["Success rate last 30 days", "Backups last 7 days", "p95 duration last 30 days"]) {
        expect(kpi(label)).toHaveAttribute("aria-busy", "true");
      }
    });

    it("says it could not load a figure and retries that query on request", async () => {
      const health = query<ConnectionsHealth>({ isError: true, error: new Error("boom") });
      mockQueries(health, query({ data: month() }));
      const user = userEvent.setup();

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      const group = kpi("Success rate last 30 days");
      expect(figure("Success rate last 30 days")).toHaveTextContent("—");
      expect(group).toHaveTextContent("Could not load");
      await user.click(within(group).getByRole("button", { name: "Retry" }));
      expect(health.refetch).toHaveBeenCalledTimes(1);
      // The p95 card reads the same answer, so it fails with it; the backups card does not.
      expect(kpi("p95 duration last 30 days")).toHaveTextContent("Could not load");
      expect(kpi("Backups last 7 days")).not.toHaveTextContent("Could not load");
    });

    it("keeps the figures it has when a later refetch fails", () => {
      mockQueries(query({ data: HEALTH, isError: true }), query({ data: month(), isError: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate last 30 days")).toHaveTextContent("97.4%");
      expect(kpi("Success rate last 30 days")).not.toHaveTextContent("Could not load");
    });

    it("says the backups card could not load when the daily series fails, and keeps the health figures", () => {
      mockQueries(query({ data: HEALTH }), query({ isError: true }));

      render(<KpiGrid restoresLoading={false} restores={[]} />);

      expect(figure("Success rate last 30 days")).toHaveTextContent("97.4%");
      expect(plots.byKey.size).toBe(0);
      expect(kpi("Backups last 7 days")).toHaveTextContent("Could not load");
    });
  });
});
