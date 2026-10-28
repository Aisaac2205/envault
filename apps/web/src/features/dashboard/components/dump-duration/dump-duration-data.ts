import type { ChartBrushSelection } from "@/shared/ui/charts/chart-brush";
import type { AnalyticsWindow, DailyBackupPoint } from "../../types";

/** The chart always asks the API for the widest window; the brush narrows it. */
export const ANALYTICS_WINDOW: AnalyticsWindow = 90;

/** Days shown before the user touches the brush. */
export const DEFAULT_BRUSH_DAYS = 30;

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

/** Quick range presets, in days counted back from the newest day. */
export const QUICK_RANGE_DAYS = [7, 30, 90] as const;
export type QuickRangeDays = (typeof QUICK_RANGE_DAYS)[number];

/** The brush range that shows the last `days` days of the series. */
export function quickRange(
  rows: DurationRow[],
  days: QuickRangeDays,
): ChartBrushSelection | null {
  return defaultBrushRange(rows, days);
}

/**
 * The preset whose days a range shows, or `null` for a custom range. It compares
 * the rows the range shows, not its timestamps: a dragged brush edge lands
 * anywhere inside a day, and the chart draws the same days either way.
 */
export function activeQuickRange(
  rows: DurationRow[],
  range: ChartBrushSelection | null,
): QuickRangeDays | null {
  if (!range || rows.length === 0) {
    return null;
  }
  const start = range.start.getTime();
  const end = range.end.getTime();
  let first = -1;
  let last = -1;
  rows.forEach((row, index) => {
    const time = row.date.getTime();
    if (time >= start && time <= end) {
      first = first === -1 ? index : first;
      last = index;
    }
  });
  if (first === -1 || last !== rows.length - 1) {
    return null;
  }
  return (
    QUICK_RANGE_DAYS.find((days) => first === Math.max(0, rows.length - days)) ??
    null
  );
}

/** The last {@link DEFAULT_BRUSH_DAYS} days, or the whole series when it is shorter. */
export function defaultBrushRange(
  rows: DurationRow[],
  days = DEFAULT_BRUSH_DAYS,
): ChartBrushSelection | null {
  const first = rows[Math.max(0, rows.length - days)];
  const last = rows.at(-1);
  if (!first || !last || rows.length < 2) {
    return null;
  }
  return { start: first.date, end: last.date };
}

/** Most recent day with a duration, optionally inside the visible range. */
export function findLatestDayWithData(
  rows: DurationRow[],
  range?: ChartBrushSelection | null,
): DurationRow | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (!row || !rowHasData(row)) {
      continue;
    }
    if (
      range &&
      (row.date.getTime() < range.start.getTime() ||
        row.date.getTime() > range.end.getTime())
    ) {
      continue;
    }
    return row;
  }
  return null;
}

export function toConnectionId(selectValue: string): string | undefined {
  return selectValue === ALL_CONNECTIONS ? undefined : selectValue;
}
