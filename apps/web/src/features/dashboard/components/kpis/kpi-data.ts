import type { AnalyticsWindow, DailyBackupPoint, RestoreJob } from "../../types";
import { parseDay } from "../dump-duration/dump-duration-data";

/** The window the KPIs summarise, in days. It is the one the charts below open on, so the queries are shared. */
export const KPI_WINDOW_DAYS: AnalyticsWindow = 30;

/** The longer window the 30 day figures are compared with. */
export const BASELINE_WINDOW_DAYS: AnalyticsWindow = 90;

/** Days counted by the "Backups" KPI. */
export const RECENT_BACKUP_DAYS = 7;

/** One day of a KPI sparkline. `null` is a gap: the day has no value, which is not zero. */
export type DayValue = { date: string; value: number | null };

const DAY_MS = 86_400_000;

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Completed backups of the `count` UTC calendar days that end on `endDay`,
 * oldest first. A day the series has no row for counts as zero: this is a
 * calendar window, not "the last N rows", so a quiet week never reaches back
 * to older busy days.
 */
export function lastCalendarDays(
  days: DailyBackupPoint[],
  count: number,
  endDay: string,
): DayValue[] {
  const completedByDay = new Map(days.map((day) => [day.date, day.completed]));
  const [year, month, date] = endDay.split("-").map(Number);
  const end = Date.UTC(year ?? Number.NaN, (month ?? 1) - 1, date ?? Number.NaN);

  return Array.from({ length: count }, (_, index) => {
    const label = utcDay(end - (count - 1 - index) * DAY_MS);
    return { date: label, value: completedByDay.get(label) ?? 0 };
  });
}

/** True when at least one day of the series has a value (zero included). */
export function hasSeriesData(series: DayValue[]): boolean {
  return series.some((point) => point.value !== null);
}

/** The newest restore, whatever the order the list came in. `null` without restores. */
export function pickLastRestore(restores: RestoreJob[]): RestoreJob | null {
  let newest: RestoreJob | null = null;
  for (const restore of restores) {
    if (newest === null || Date.parse(restore.createdAt) > Date.parse(newest.createdAt)) {
      newest = restore;
    }
  }
  return newest;
}

/** `Oct 27` / `27 oct`: a UTC calendar day from the API, kept on the same calendar day. */
export function formatDayLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(parseDay(day));
}

/** Where a figure stands against its reference. */
export type Trend = "up" | "down" | "flat";

export interface Change {
  trend: Trend;
  /** Signed, already rounded to what the screen shows, so `flat` always reads as zero. */
  value: number;
}

/** Rounds half away from zero, so a move up and the same move down read alike. Never returns -0. */
function roundAway(value: number, digits: number): number {
  const factor = 10 ** digits;
  // The epsilon keeps 1.25 * 10 = 12.499999999999998 from rounding down.
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
  return rounded === 0 ? 0 : rounded;
}

function toChange(value: number): Change {
  return { trend: value > 0 ? "up" : value < 0 ? "down" : "flat", value };
}

/** How far a 0 to 1 rate moved, in percentage points to one decimal. `null` when either rate is missing. */
export function rateChange(
  current: number | null | undefined,
  baseline: number | null | undefined,
): Change | null {
  if (current == null || baseline == null) return null;
  return toChange(roundAway((current - baseline) * 100, 1));
}

/** How much a figure grew or shrank against a baseline, as a 0 to 1 share to whole percents. `null` without a baseline above zero. */
export function relativeChange(
  current: number | null | undefined,
  baseline: number | null | undefined,
): Change | null {
  if (current == null || baseline == null || !(baseline > 0)) return null;
  return toChange(roundAway((current - baseline) / baseline, 2));
}

/** The signed difference between two counts. A previous count of zero is fine: it is a difference, not a share. */
export function countChange(current: number, previous: number): Change {
  return toChange(current - previous);
}

/** The sum of a run of days; a gap counts as nothing. */
export function sumValues(series: DayValue[]): number {
  return series.reduce((total, point) => total + (point.value ?? 0), 0);
}
