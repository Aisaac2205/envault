import type { DailyBackupPoint } from "../../types";

/** Select value for "no connection filter". Radix Select rejects an empty value. */
export const ALL_CONNECTIONS = "all";

export type DurationKey = "p50" | "p95" | "max";

/** One chart row. A day without a completed backup keeps `null` and renders as a gap. */
export type DurationRow = {
  date: Date;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

/**
 * The API reports UTC calendar days (`YYYY-MM-DD`). The chart labels days with
 * local date parts, so each day becomes local midnight of that same calendar
 * day. Parsing the string with `new Date()` would give UTC midnight and shift
 * the label back a day west of Greenwich.
 */
export function parseDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? Number.NaN, (month ?? 1) - 1, date ?? Number.NaN);
}

export function toDurationRows(days: DailyBackupPoint[]): DurationRow[] {
  return days.map((day) => ({
    date: parseDay(day.date),
    p50: day.p50DurationSeconds,
    p95: day.p95DurationSeconds,
    max: day.maxDurationSeconds,
  }));
}

/** True when the day has at least one of the three durations. */
export function rowHasData(row: DurationRow): boolean {
  return row.p50 !== null || row.p95 !== null || row.max !== null;
}

/** True when at least one day in the series has a duration. */
export function hasDurationData(rows: DurationRow[]): boolean {
  return rows.some(rowHasData);
}

/**
 * Quick range presets: how many days the chart shows. Each one is the window
 * asked of the API, so the chart draws every day it gets back.
 */
export const QUICK_RANGE_DAYS = [7, 30, 90] as const;
export type QuickRangeDays = (typeof QUICK_RANGE_DAYS)[number];

/** The range selected until the user picks another one. */
export const DEFAULT_RANGE_DAYS: QuickRangeDays = 30;

/** Most recent day with a duration, or `null` when no day has one. */
export function findLatestDayWithData(rows: DurationRow[]): DurationRow | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row && rowHasData(row)) {
      return row;
    }
  }
  return null;
}

export function toConnectionId(selectValue: string): string | undefined {
  return selectValue === ALL_CONNECTIONS ? undefined : selectValue;
}
