import { DailyBackupRawRow } from './jobs-analytics.types';

const MS_PER_DAY = 86_400_000;

function toUtcDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns `window` UTC calendar dates in ascending order, ending with the
 * UTC calendar day of `now` (today included).
 */
export function buildUtcDayRange(now: Date, window: number): string[] {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const days: string[] = [];
  for (let offset = window - 1; offset >= 0; offset--) {
    days.push(toUtcDateString(new Date(startOfToday - offset * MS_PER_DAY)));
  }
  return days;
}

/** Returns the UTC calendar date string immediately after `dateStr` (YYYY-MM-DD). */
export function nextUtcDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + MS_PER_DAY);
  return toUtcDateString(next);
}

/** Rounds `value` to `decimals` places using standard half-up rounding. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface ParsedDailyRow {
  date: string;
  completed: number;
  failed: number;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  totalSizeMb: number;
}

/** Converts a raw node-pg row into typed, rounded numbers. */
export function parseDailyRow(row: DailyBackupRawRow): ParsedDailyRow {
  return {
    date: row.date,
    completed: Number(row.completed),
    failed: Number(row.failed),
    p50DurationSeconds: row.p50 === null ? null : roundTo(row.p50, 1),
    p95DurationSeconds: row.p95 === null ? null : roundTo(row.p95, 1),
    totalSizeMb: roundTo(row.totalSizeMb, 2),
  };
}

/**
 * Fills every day in `days` with its matching parsed row, or a zero-value
 * entry when no row exists for that date. Rows outside `days` are ignored.
 */
export function zeroFillDailySeries(days: string[], rows: ParsedDailyRow[]): ParsedDailyRow[] {
  const daySet = new Set(days);
  const rowsByDate = new Map(rows.filter((row) => daySet.has(row.date)).map((row) => [row.date, row]));

  return days.map((date) => {
    const existing = rowsByDate.get(date);
    if (existing) return existing;

    return {
      date,
      completed: 0,
      failed: 0,
      p50DurationSeconds: null,
      p95DurationSeconds: null,
      totalSizeMb: 0,
    };
  });
}
