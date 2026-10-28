import { describe, expect, it } from "vitest";
import type { DailyBackupPoint } from "../../types";
import {
  barGapFor,
  findLatestActiveDay,
  formatCount,
  formatRate,
  hasBackupData,
  MAX_BAR_PX,
  successRate,
  sumBackups,
  toBackupRows,
} from "../backups-per-day/backups-per-day-data";

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

/** `count` consecutive UTC days ending on 2026-10-27. */
function lastDays(count: number): DailyBackupPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 27 - (count - 1 - index)));
    return day(date.toISOString().slice(0, 10));
  });
}

describe("toBackupRows", () => {
  it("labels each day with the active language, not the browser's", () => {
    const days = [day("2026-10-26", 3, 1), day("2026-10-27", 4, 0)];

    expect(toBackupRows(days, "es-AR").map((row) => row.label)).toEqual(["26 oct", "27 oct"]);
    expect(toBackupRows(days, "en-US").map((row) => row.label)).toEqual(["Oct 26", "Oct 27"]);
  });

  it("keeps the calendar day as a local date and the counts as they come", () => {
    const [row] = toBackupRows([day("2026-10-27", 7, 2)], "es-AR");

    expect(row?.date.getFullYear()).toBe(2026);
    expect(row?.date.getMonth()).toBe(9);
    expect(row?.date.getDate()).toBe(27);
    expect(row).toMatchObject({ completed: 7, failed: 2 });
  });

  it("gives every day of a 90 day window its own label", () => {
    const labels = toBackupRows(lastDays(90), "es-AR").map((row) => row.label);

    // The bar chart's band domain is the labels: a repeated one would merge two days.
    expect(new Set(labels).size).toBe(90);
  });

  it("adds the year to every label when two days would otherwise share one", () => {
    const days = [day("2025-10-27"), day("2026-10-27")];

    const labels = toBackupRows(days, "en-US").map((row) => row.label);

    expect(labels).toEqual(["Oct 27, 2025", "Oct 27, 2026"]);
  });

  it("returns no rows for no days", () => {
    expect(toBackupRows([], "es-AR")).toEqual([]);
  });
});

describe("successRate", () => {
  it("is completed over completed plus failed", () => {
    expect(successRate(24, 1)).toBeCloseTo(0.96);
    expect(successRate(1, 1)).toBe(0.5);
    expect(successRate(5, 0)).toBe(1);
    expect(successRate(0, 3)).toBe(0);
  });

  it("is null for a day with nothing finished, not 0 or 100", () => {
    expect(successRate(0, 0)).toBeNull();
  });
});

describe("formatRate", () => {
  it("shows an em dash when there is no rate", () => {
    expect(formatRate(null, "es-AR")).toBe("—");
  });

  it("shows whole percents without decimals", () => {
    expect(formatRate(0.96, "en-US")).toBe("96%");
    expect(formatRate(0, "en-US")).toBe("0%");
    expect(formatRate(1, "en-US")).toBe("100%");
  });

  it("keeps one decimal for a rate that is not whole", () => {
    expect(formatRate(2 / 3, "en-US")).toBe("66.6%");
    expect(formatRate(2 / 3, "es-AR")).toBe("66,6%");
  });

  it("never rounds a rate with failures up to 100%", () => {
    // 1 failure in 250 is 99.6%, which must not read as a perfect run.
    expect(formatRate(249 / 250, "en-US")).toBe("99.6%");
    expect(formatRate(999 / 1000, "en-US")).toBe("99.9%");
    expect(formatRate(9999 / 10000, "en-US")).toBe("99.9%");
  });

  it("is not thrown off by floating point at exact tenths", () => {
    expect(formatRate(0.29, "en-US")).toBe("29%");
    expect(formatRate(0.57, "en-US")).toBe("57%");
  });
});

describe("formatCount", () => {
  it("groups thousands by the language", () => {
    expect(formatCount(1234, "en-US")).toBe("1,234");
    expect(formatCount(1234, "es-AR")).toBe("1.234");
  });
});

describe("hasBackupData / sumBackups / findLatestActiveDay", () => {
  const rows = toBackupRows(
    [day("2026-10-25", 4, 1), day("2026-10-26", 0, 2), day("2026-10-27")],
    "es-AR",
  );

  it("is false for a window of empty days", () => {
    expect(hasBackupData(toBackupRows(lastDays(30), "es-AR"))).toBe(false);
    expect(hasBackupData([])).toBe(false);
  });

  it("is true when any day completed or failed a backup", () => {
    expect(hasBackupData(rows)).toBe(true);
    expect(hasBackupData(toBackupRows([day("2026-10-27", 0, 1)], "es-AR"))).toBe(true);
  });

  it("sums both statuses over the window", () => {
    expect(sumBackups(rows)).toEqual({ completed: 4, failed: 3 });
  });

  it("finds the newest day that ran something, skipping empty days after it", () => {
    expect(findLatestActiveDay(rows)?.label).toBe("26 oct");
  });

  it("finds nothing in an empty window", () => {
    expect(findLatestActiveDay(toBackupRows(lastDays(7), "es-AR"))).toBeNull();
  });
});

describe("barGapFor", () => {
  /** The bar thickness d3's band scale gives for this padding. */
  function barWidth(innerWidth: number, count: number, gap: number) {
    return (innerWidth * (1 - gap)) / (count + gap);
  }

  it("caps a bar at the maximum thickness when the window has few days", () => {
    const gap = barGapFor(1050, 7);

    expect(barWidth(1050, 7, gap)).toBeCloseTo(MAX_BAR_PX, 1);
  });

  it("leaves the default gap when the bars are already thinner than the cap", () => {
    expect(barGapFor(600, 90)).toBe(0.2);
    expect(barGapFor(1050, 90)).toBe(0.2);
  });

  it("keeps bars apart on a narrow screen", () => {
    expect(barGapFor(260, 90)).toBeGreaterThanOrEqual(0.2);
    expect(barGapFor(260, 7)).toBeGreaterThanOrEqual(0.2);
  });

  it("falls back to the default gap before the chart has a width", () => {
    expect(barGapFor(0, 30)).toBe(0.2);
    expect(barGapFor(-5, 30)).toBe(0.2);
    expect(barGapFor(500, 0)).toBe(0.2);
  });

  it("stays a valid padding", () => {
    expect(barGapFor(100000, 1)).toBeLessThanOrEqual(0.9);
  });
});
