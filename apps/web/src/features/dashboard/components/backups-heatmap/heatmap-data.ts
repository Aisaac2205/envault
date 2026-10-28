import type { HeatmapBin, HeatmapColumn } from "@/shared/ui/charts/heatmap";
import type { DailyBackupPoint } from "../../types";
import { parseDay } from "../dump-duration/dump-duration-data";

/** Days the calendar shows. */
export const CALENDAR_DAYS = 90;

/** First row of the grid: `0` is Sunday, `1` is Monday. */
export type WeekStart = 0 | 1;

/**
 * How bad a day was. It is the `count` of a heatmap cell, which the chart turns
 * into a color: 0 no backups, 1 none failed, then 1-2, 3-5 and 6 or more failed.
 */
export type FailureLevel = 0 | 1 | 2 | 3 | 4;

/** Most failures a day can have and still be in the "few" bucket. */
const FEW_FAILURES = 2;
/** Most failures a day can have and still be in the "several" bucket. */
const SEVERAL_FAILURES = 5;

/**
 * The bucket of a day. A day on which nothing ran is its own level: it is not a
 * day without failures, and the calendar shows the two differently.
 */
export function failureLevel(completed: number, failed: number): FailureLevel {
  if (completed + failed === 0) return 0;
  if (failed === 0) return 1;
  if (failed <= FEW_FAILURES) return 2;
  if (failed <= SEVERAL_FAILURES) return 3;
  return 4;
}

/** Monday first, as in Spanish, unless the page is in English. */
export function weekStartFor(locale: string): WeekStart {
  return locale.startsWith("en") ? 0 : 1;
}

/** A Sunday: the reference week the weekday names are read from. */
const REFERENCE_SUNDAY = new Date(2024, 0, 7);

/** Short weekday names in the order of the grid's rows: `["lun", "mar", ...]`. */
export function weekdayLabels(locale: string, weekStart: WeekStart): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short" });
  return Array.from({ length: 7 }, (_, row) => {
    const weekday = new Date(
      REFERENCE_SUNDAY.getFullYear(),
      REFERENCE_SUNDAY.getMonth(),
      REFERENCE_SUNDAY.getDate() + ((weekStart + row) % 7),
    );
    return format.format(weekday);
  });
}

/** `2026-10-07` for a local date: the key the API's `date` fields use. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `count` empty days that end on `endDay` (a UTC calendar day): the shape of the grid before any data arrives. */
export function emptyWindow(endDay: string, count: number = CALENDAR_DAYS): DailyBackupPoint[] {
  const [year, month, date] = endDay.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const utc = new Date(Date.UTC(year ?? Number.NaN, (month ?? 1) - 1, (date ?? Number.NaN) - (count - 1 - index)));
    return {
      date: utc.toISOString().slice(0, 10),
      completed: 0,
      failed: 0,
      p50DurationSeconds: null,
      p95DurationSeconds: null,
      maxDurationSeconds: null,
      totalSizeMb: 0,
    };
  });
}

/**
 * The grid: one column per week, seven rows, one cell per day. The slots of the
 * first and last week that fall outside the window keep their place (so every day
 * sits on its weekday) and are flagged `hidden`.
 */
export function buildCalendarColumns(days: DailyBackupPoint[], weekStart: WeekStart): HeatmapColumn[] {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return [];

  const byDay = new Map(days.map((point) => [point.date, point]));
  const start = parseDay(first.date);
  const end = parseDay(last.date);
  const lead = (start.getDay() - weekStart + 7) % 7;
  const gridStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - lead);
  const span = Math.round((end.getTime() - gridStart.getTime()) / 86_400_000) + 1;
  const weeks = Math.ceil(span / 7);

  return Array.from({ length: weeks }, (_, column) => ({
    bin: column,
    bins: Array.from({ length: 7 }, (_, row): HeatmapBin => {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + column * 7 + row,
      );
      const point = byDay.get(dayKey(date));
      return point
        ? { bin: row, count: failureLevel(point.completed, point.failed), date }
        : { bin: row, count: 0, date, hidden: true };
    }),
  }));
}

export interface FailureSummary {
  /** Days on which a backup completed or failed. */
  activeDays: number;
  /** Days on which at least one backup failed. */
  failedDays: number;
  completed: number;
  failed: number;
  /** Days since the last failed backup, counted back from the newest day (0 when that day failed). */
  streak: number;
}

export function summarizeFailures(days: DailyBackupPoint[]): FailureSummary {
  let activeDays = 0;
  let failedDays = 0;
  let completed = 0;
  let failed = 0;
  for (const point of days) {
    if (point.completed + point.failed > 0) activeDays += 1;
    if (point.failed > 0) failedDays += 1;
    completed += point.completed;
    failed += point.failed;
  }

  let streak = 0;
  for (let index = days.length - 1; index >= 0 && days[index]?.failed === 0; index--) {
    streak += 1;
  }
  return { activeDays, failedDays, completed, failed, streak };
}

/** The days with at least one failed backup, newest first. */
export function failureDays(days: DailyBackupPoint[]): DailyBackupPoint[] {
  return days.filter((point) => point.failed > 0).reverse();
}
