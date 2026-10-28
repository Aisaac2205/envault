import { describe, expect, it } from "vitest";
import type { DailyBackupPoint } from "../../types";
import {
  buildCalendarColumns,
  dayKey,
  emptyWindow,
  failureDays,
  failureLevel,
  summarizeFailures,
  weekStartFor,
  weekdayLabels,
} from "../backups-heatmap/heatmap-data";

function day(date: string, completed = 0, failed = 0): DailyBackupPoint {
  return {
    date,
    completed,
    failed,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    maxDurationSeconds: null,
    totalSizeMb: 0,
  };
}

/** `count` consecutive UTC days ending on `end`, all empty. */
function window(count: number, end = "2026-10-27"): DailyBackupPoint[] {
  const [year, month, date] = end.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const utc = new Date(Date.UTC(year!, month! - 1, date! - (count - 1 - index)));
    return day(utc.toISOString().slice(0, 10));
  });
}

describe("failureLevel", () => {
  it("tells a day with no backups apart from a day with no failures", () => {
    expect(failureLevel(0, 0)).toBe(0);
    expect(failureLevel(24, 0)).toBe(1);
  });

  it("steps up with the failures: 1-2, 3-5, 6 or more", () => {
    expect([1, 2].map((failed) => failureLevel(20, failed))).toEqual([2, 2]);
    expect([3, 4, 5].map((failed) => failureLevel(20, failed))).toEqual([3, 3, 3]);
    expect([6, 7, 40].map((failed) => failureLevel(20, failed))).toEqual([4, 4, 4]);
  });

  it("counts a day that only failed", () => {
    expect(failureLevel(0, 1)).toBe(2);
  });
});

describe("weekStartFor", () => {
  it("starts the week on Sunday in English and on Monday in Spanish", () => {
    expect(weekStartFor("en-US")).toBe(0);
    expect(weekStartFor("es-AR")).toBe(1);
  });
});

describe("weekdayLabels", () => {
  it("lists the seven weekdays from the week start, in the language", () => {
    expect(weekdayLabels("en-US", 0)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayLabels("en-US", 1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels("es-AR", 1)[0]?.toLowerCase()).toBe("lun");
    expect(weekdayLabels("es-AR", 1)).toHaveLength(7);
  });
});

describe("dayKey", () => {
  it("is the calendar day of a local date, as the API writes it", () => {
    expect(dayKey(new Date(2026, 9, 7))).toBe("2026-10-07");
    expect(dayKey(new Date(2026, 0, 31))).toBe("2026-01-31");
  });
});

describe("emptyWindow", () => {
  it("makes a zero filled run of days that ends on the given day", () => {
    const days = emptyWindow("2026-10-27", 90);

    expect(days).toHaveLength(90);
    expect(days[0]?.date).toBe("2026-07-30");
    expect(days.at(-1)?.date).toBe("2026-10-27");
    expect(days.every((point) => point.completed === 0 && point.failed === 0)).toBe(true);
  });
});

describe("buildCalendarColumns", () => {
  // 2026-07-30 (a Thursday) to 2026-10-27 (a Tuesday): 90 days.
  const days = window(90);

  it("lays 90 days out as weeks of seven rows, Monday first", () => {
    const columns = buildCalendarColumns(days, 1);

    expect(columns).toHaveLength(14);
    expect(columns.every((column) => column.bins.length === 7)).toBe(true);
    expect(columns[0]?.bins.map((bin) => bin.date.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(columns[0]?.bins.map((bin) => bin.bin)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(columns.map((column) => column.bin)).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it("lays the same days out Sunday first", () => {
    const columns = buildCalendarColumns(days, 0);

    expect(columns).toHaveLength(14);
    expect(columns[0]?.bins.map((bin) => bin.date.getDay())).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("hides the empty slots of the first and last week and nothing else", () => {
    const columns = buildCalendarColumns(days, 1);
    const hidden = columns.flatMap((column) => column.bins).filter((bin) => bin.hidden);

    // The window starts on a Thursday (3 slots before it) and ends on a Tuesday (5 after it).
    expect(hidden).toHaveLength(8);
    expect(columns[0]?.bins.slice(0, 3).every((bin) => bin.hidden)).toBe(true);
    expect(columns[0]?.bins[3]?.hidden).toBeFalsy();
    expect(columns.at(-1)?.bins[1]?.hidden).toBeFalsy();
    expect(columns.at(-1)?.bins.slice(2).every((bin) => bin.hidden)).toBe(true);
  });

  it("puts each day on its own weekday row and column, one cell per day", () => {
    const columns = buildCalendarColumns(days, 1);
    const visible = columns.flatMap((column) => column.bins).filter((bin) => !bin.hidden);

    expect(visible).toHaveLength(90);
    expect(dayKey(visible[0]!.date)).toBe("2026-07-30");
    expect(dayKey(visible.at(-1)!.date)).toBe("2026-10-27");
    // 2026-10-26 is the Monday of the last week: first row of the last column.
    expect(dayKey(columns.at(-1)!.bins[0]!.date)).toBe("2026-10-26");
  });

  it("encodes the failures of a day in its count", () => {
    const filled = days.map((point) => {
      if (point.date === "2026-10-20") return day(point.date, 20, 4);
      if (point.date === "2026-10-21") return day(point.date, 22, 0);
      if (point.date === "2026-10-22") return day(point.date, 18, 1);
      if (point.date === "2026-10-23") return day(point.date, 0, 9);
      return point;
    });
    const bins = buildCalendarColumns(filled, 1)
      .flatMap((column) => column.bins)
      .filter((bin) => !bin.hidden);
    const levelOf = (date: string) => bins.find((bin) => dayKey(bin.date) === date)?.count;

    expect(levelOf("2026-10-20")).toBe(3);
    expect(levelOf("2026-10-21")).toBe(1);
    expect(levelOf("2026-10-22")).toBe(2);
    expect(levelOf("2026-10-23")).toBe(4);
    expect(levelOf("2026-10-24")).toBe(0);
  });

  it("returns no columns for no days", () => {
    expect(buildCalendarColumns([], 1)).toEqual([]);
  });

  it("fills a window that is a whole number of weeks without hidden slots", () => {
    // Monday 2026-10-05 to Sunday 2026-10-25: 21 days, three full Monday-first weeks.
    const columns = buildCalendarColumns(window(21, "2026-10-25"), 1);

    expect(columns).toHaveLength(3);
    expect(columns.flatMap((column) => column.bins).some((bin) => bin.hidden)).toBe(false);
  });
});

describe("summarizeFailures", () => {
  it("counts the days with backups, the days with failures and the totals", () => {
    const series = [
      day("2026-10-23", 20, 0),
      day("2026-10-24"),
      day("2026-10-25", 18, 2),
      day("2026-10-26", 0, 3),
      day("2026-10-27", 24, 0),
    ];

    expect(summarizeFailures(series)).toEqual({
      activeDays: 4,
      failedDays: 2,
      completed: 62,
      failed: 5,
      streak: 1,
    });
  });

  it("counts the days since the last failure as the streak, empty days included", () => {
    const series = [day("2026-10-24", 5, 1), day("2026-10-25", 5, 0), day("2026-10-26"), day("2026-10-27", 5, 0)];

    expect(summarizeFailures(series).streak).toBe(3);
  });

  it("is 0 when the newest day failed, and the whole window when nothing failed", () => {
    expect(summarizeFailures([day("2026-10-26", 5, 0), day("2026-10-27", 5, 1)]).streak).toBe(0);
    expect(summarizeFailures([day("2026-10-26", 5, 0), day("2026-10-27", 5, 0)]).streak).toBe(2);
  });

  it("is all zero for an empty window", () => {
    expect(summarizeFailures([])).toEqual({
      activeDays: 0,
      failedDays: 0,
      completed: 0,
      failed: 0,
      streak: 0,
    });
  });
});

describe("failureDays", () => {
  it("lists the days with failures, newest first", () => {
    const series = [day("2026-10-24", 5, 1), day("2026-10-25", 5, 0), day("2026-10-26", 0, 3), day("2026-10-27", 5, 0)];

    expect(failureDays(series).map((point) => point.date)).toEqual(["2026-10-26", "2026-10-24"]);
  });
});
