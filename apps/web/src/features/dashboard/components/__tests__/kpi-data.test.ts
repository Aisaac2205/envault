import { describe, expect, it } from "vitest";
import type { DailyBackupPoint, RestoreJob } from "../../types";
import {
  formatDayLabel,
  hasSeriesData,
  lastCalendarDays,
  pickLastRestore,
  toP95Series,
  toSuccessRateSeries,
} from "../kpis/kpi-data";

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

function restore(id: string, createdAt: string, over: Partial<RestoreJob> = {}): RestoreJob {
  return {
    id,
    targetConnectionId: "conn-dev",
    targetEnvironment: "dev",
    isDryRun: false,
    status: "completed",
    createdAt,
    ...over,
  };
}

describe("toSuccessRateSeries", () => {
  it("is the share of finished backups that completed, as a 0 to 1 fraction", () => {
    const series = toSuccessRateSeries([day("2026-10-26", { completed: 3, failed: 1 })]);

    expect(series).toEqual([{ date: "2026-10-26", value: 0.75 }]);
  });

  it("leaves a gap (null) on a day without finished backups: it is neither 0% nor 100%", () => {
    const series = toSuccessRateSeries([
      day("2026-10-25", { completed: 2 }),
      day("2026-10-26"),
      day("2026-10-27", { failed: 2 }),
    ]);

    expect(series.map((point) => point.value)).toEqual([1, null, 0]);
  });
});

describe("toP95Series", () => {
  it("keeps the 95th percentile of each day and a gap where no backup completed", () => {
    const series = toP95Series([
      day("2026-10-26", { completed: 2, p95DurationSeconds: 12.4 }),
      day("2026-10-27"),
    ]);

    expect(series).toEqual([
      { date: "2026-10-26", value: 12.4 },
      { date: "2026-10-27", value: null },
    ]);
  });
});

describe("lastCalendarDays", () => {
  const month = Array.from({ length: 30 }, (_, index) =>
    day(new Date(Date.UTC(2026, 9, 28 - 30 + index)).toISOString().slice(0, 10), {
      completed: index,
    }),
  );

  it("takes exactly the last 7 UTC calendar days of a zero-filled series, oldest first", () => {
    const week = lastCalendarDays(month, 7, "2026-10-27");

    expect(week.map((point) => point.date)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(week.map((point) => point.value)).toEqual([23, 24, 25, 26, 27, 28, 29]);
  });

  it("counts a calendar day with no row as zero instead of sliding back to older days", () => {
    // Only 3 rows with data in the last week; slice(-7) of these would reach into
    // August and call them "the last 7 days".
    const sparse = [
      day("2026-08-23", { completed: 40 }),
      day("2026-10-22", { completed: 5 }),
      day("2026-10-25", { completed: 2 }),
      day("2026-10-27", { completed: 9 }),
    ];

    const week = lastCalendarDays(sparse, 7, "2026-10-27");

    expect(week.map((point) => point.value)).toEqual([0, 5, 0, 0, 2, 0, 9]);
  });

  it("ignores days after the end day", () => {
    const week = lastCalendarDays([day("2026-10-27", { completed: 1 }), day("2026-10-28", { completed: 9 })], 2, "2026-10-27");

    expect(week.map((point) => point.value)).toEqual([0, 1]);
  });

  it("crosses a month boundary", () => {
    const week = lastCalendarDays([], 4, "2026-11-02");

    expect(week.map((point) => point.date)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("hasSeriesData", () => {
  it("is false for an empty series and for one made only of gaps", () => {
    expect(hasSeriesData([])).toBe(false);
    expect(hasSeriesData([{ date: "2026-10-27", value: null }])).toBe(false);
  });

  it("is true as soon as one day has a value, zero included", () => {
    expect(hasSeriesData([{ date: "2026-10-27", value: 0 }])).toBe(true);
  });
});

describe("pickLastRestore", () => {
  it("is null without restores", () => {
    expect(pickLastRestore([])).toBeNull();
  });

  it("is the newest restore whatever the order of the list", () => {
    const restores = [
      restore("old", "2026-10-25T10:00:00.000Z"),
      restore("newest", "2026-10-27T09:00:00.000Z"),
      restore("mid", "2026-10-26T10:00:00.000Z"),
    ];

    expect(pickLastRestore(restores)?.id).toBe("newest");
  });
});

describe("formatDayLabel", () => {
  it("formats a UTC calendar day without shifting it west of Greenwich", () => {
    expect(formatDayLabel("2026-10-27", "en-US")).toBe("Oct 27");
  });
});
