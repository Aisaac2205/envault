import type { AnalyticsWindow, DailyBackupPoint } from "../../types";
import { parseDay } from "../dump-duration/dump-duration-data";

/** Days shown until the user picks another quick range. */
export const DEFAULT_WINDOW: AnalyticsWindow = 30;

/** Thickest a bar gets, in px. Few days on a wide card leave air, not fat blocks. */
export const MAX_BAR_PX = 28;

/** Space between bars as a share of a band: the chart's own default. */
const MIN_BAR_GAP = 0.2;
const MAX_BAR_GAP = 0.9;

/** One chart row: a day with how many backups completed and failed. */
export type BackupDayRow = {
  /**
   * The x axis label, already in the active language. The bar chart takes its
   * band domain from the labels, so each one has to be unique.
   */
  label: string;
  date: Date;
  completed: number;
  failed: number;
};

/**
 * One row per day. The label is `27 oct`; if two days of the series would share
 * one (a series longer than a year) every label gets its year.
 */
export function toBackupRows(days: DailyBackupPoint[], locale: string): BackupDayRow[] {
  const withLabel = (options: Intl.DateTimeFormatOptions) => {
    const format = new Intl.DateTimeFormat(locale, options);
    return days.map((day) => {
      const date = parseDay(day.date);
      return {
        label: format.format(date),
        date,
        completed: day.completed,
        failed: day.failed,
      };
    });
  };

  const rows = withLabel({ day: "numeric", month: "short" });
  if (new Set(rows.map((row) => row.label)).size === rows.length) {
    return rows;
  }
  return withLabel({ day: "numeric", month: "short", year: "numeric" });
}

/**
 * Completed over completed plus failed, as a 0 to 1 fraction. A day with
 * neither has no rate (`null`): it is neither 0% nor 100%.
 */
export function successRate(completed: number, failed: number): number | null {
  const finished = completed + failed;
  return finished === 0 ? null : completed / finished;
}

/**
 * A rate for the screen: `96%`, `66.6%`, or `—` without one. It rounds down to a
 * tenth, so one failure in 250 backups reads 99.6%, never a perfect 100%.
 */
export function formatRate(rate: number | null, locale: string): string {
  if (rate === null) {
    return "—";
  }
  // The epsilon keeps 0.29 * 1000 = 289.99999999999994 from losing a tenth.
  const floored = Math.floor(rate * 1000 + 1e-9) / 1000;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(floored);
}

export function formatCount(count: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(count);
}

/** True when at least one day completed or failed a backup. */
export function hasBackupData(rows: BackupDayRow[]): boolean {
  return rows.some((row) => row.completed + row.failed > 0);
}

export function sumBackups(rows: BackupDayRow[]): { completed: number; failed: number } {
  return rows.reduce(
    (total, row) => ({
      completed: total.completed + row.completed,
      failed: total.failed + row.failed,
    }),
    { completed: 0, failed: 0 },
  );
}

/** The newest day that completed or failed a backup, or `null`. */
export function findLatestActiveDay(rows: BackupDayRow[]): BackupDayRow | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row && row.completed + row.failed > 0) {
      return row;
    }
  }
  return null;
}

/**
 * The band padding (a 0 to 1 share of a band) that keeps bars at most
 * {@link MAX_BAR_PX} thick. d3's band scale makes a bar
 * `width * (1 - gap) / (count + gap)` wide, so this solves that for the gap.
 * Before the chart has a width it returns the default.
 */
export function barGapFor(innerWidth: number, count: number): number {
  if (!(innerWidth > 0) || count < 1) {
    return MIN_BAR_GAP;
  }
  const gap = (innerWidth - MAX_BAR_PX * count) / (innerWidth + MAX_BAR_PX);
  return Math.min(MAX_BAR_GAP, Math.max(MIN_BAR_GAP, gap));
}
