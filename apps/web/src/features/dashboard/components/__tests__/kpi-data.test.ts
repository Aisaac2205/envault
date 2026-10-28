import { describe, expect, it } from "vitest";
import type { DailyBackupPoint, RestoreJob } from "../../types";
import {
  countChange,
  formatDayLabel,
  hasSeriesData,
  lastCalendarDays,
  pickLastRestore,
  rateChange,
  relativeChange,
  sumValues,
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

describe("rateChange", () => {
  it("is the distance in percentage points, up or down", () => {
    expect(rateChange(0.975, 0.9625)).toEqual({ trend: "up", value: 1.3 });
    expect(rateChange(0.95, 0.9625)).toEqual({ trend: "down", value: -1.3 });
  });

  it("is flat when the move disappears at one decimal", () => {
    expect(rateChange(0.9626, 0.9625)).toEqual({ trend: "flat", value: 0 });
    expect(rateChange(0.9625, 0.9625)).toEqual({ trend: "flat", value: 0 });
  });

  it("has nothing to compare when either side has no rate", () => {
    expect(rateChange(null, 0.9)).toBeNull();
    expect(rateChange(0.9, null)).toBeNull();
    expect(rateChange(undefined, 0.9)).toBeNull();
    expect(rateChange(0.9, undefined)).toBeNull();
  });
});

describe("relativeChange", () => {
  it("is the share the figure grew or shrank by against the baseline", () => {
    expect(relativeChange(12.4, 10)).toEqual({ trend: "up", value: 0.24 });
    expect(relativeChange(7.5, 10)).toEqual({ trend: "down", value: -0.25 });
  });

  it("is flat when the move rounds to 0%", () => {
    expect(relativeChange(10.04, 10)).toEqual({ trend: "flat", value: 0 });
    expect(relativeChange(10, 10)).toEqual({ trend: "flat", value: 0 });
  });

  it("has nothing to compare without a baseline above zero", () => {
    expect(relativeChange(5, 0)).toBeNull();
    expect(relativeChange(5, null)).toBeNull();
    expect(relativeChange(null, 5)).toBeNull();
    expect(relativeChange(undefined, 5)).toBeNull();
  });
});

describe("countChange", () => {
  it("is the signed difference between two counts", () => {
    expect(countChange(52, 28)).toEqual({ trend: "up", value: 24 });
    expect(countChange(3, 10)).toEqual({ trend: "down", value: -7 });
    expect(countChange(5, 5)).toEqual({ trend: "flat", value: 0 });
  });

  it("compares with a quiet week of zero without dividing by it", () => {
    expect(countChange(4, 0)).toEqual({ trend: "up", value: 4 });
  });
});

describe("sumValues", () => {
  it("adds the values of a run of days, counting a gap as nothing", () => {
    expect(sumValues([{ date: "2026-10-26", value: 3 }, { date: "2026-10-27", value: null }, { date: "2026-10-28", value: 4 }])).toBe(7);
    expect(sumValues([])).toBe(0);
  });
});
