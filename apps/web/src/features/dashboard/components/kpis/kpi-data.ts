import type { AnalyticsWindow, DailyBackupPoint, RestoreJob } from "../../types";
import { successRate } from "../backups-per-day/backups-per-day-data";
import { parseDay } from "../dump-duration/dump-duration-data";

/** The window the KPIs summarise, in days. It is the one the charts below open on, so the queries are shared. */
export const KPI_WINDOW_DAYS: AnalyticsWindow = 30;

/** Days counted by the "Backups" KPI. */
export const RECENT_BACKUP_DAYS = 7;

/** One day of a KPI sparkline. `null` is a gap: the day has no value, which is not zero. */
export type DayValue = { date: string; value: number | null };

/** Daily success rate as a 0 to 1 fraction; a day with no finished backup is a gap. */
export function toSuccessRateSeries(days: DailyBackupPoint[]): DayValue[] {
  return days.map((day) => ({
    date: day.date,
    value: successRate(day.completed, day.failed),
  }));
}

/** Daily 95th percentile duration in seconds; a day without a completed backup is a gap. */
export function toP95Series(days: DailyBackupPoint[]): DayValue[] {
  return days.map((day) => ({ date: day.date, value: day.p95DurationSeconds }));
}

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
