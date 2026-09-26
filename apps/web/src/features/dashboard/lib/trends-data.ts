import type { DailyBackupPoint } from "../types";

export interface OutcomeRow {
  date: string;
  completed: number;
  failed: number;
}

/**
 * Outcome chart rows: completed/failed counts straight through, including a
 * zero-count day as a real `0` (never omitted or coerced to null) — the
 * vendored `Bar` skips a datum only when `typeof value !== "number"`, so a
 * genuine `0` still renders as a zero-height column (Zero day scenario).
 */
export function mapOutcomeRows(days: DailyBackupPoint[]): OutcomeRow[] {
  return days.map((day) => ({ date: day.date, completed: day.completed, failed: day.failed }));
}

export interface DurationRow {
  date: string;
  p50: number | null;
  p95: number | null;
}

/**
 * Duration chart rows: a `null` p50/p95 day stays `null` — the vendored
 * `Line`'s `defined={(d) => d[dataKey] != null}` patch (S1) renders a real
 * gap for `null`, never interpolating to zero (Null duration scenario).
 */
export function mapDurationRows(days: DailyBackupPoint[]): DurationRow[] {
  return days.map((day) => ({ date: day.date, p50: day.p50DurationSeconds, p95: day.p95DurationSeconds }));
}

export interface SizeRow {
  date: string;
  size: number;
}

export function mapSizeRows(days: DailyBackupPoint[]): SizeRow[] {
  return days.map((day) => ({ date: day.date, size: day.totalSizeMb }));
}

export interface OutcomeTotals {
  completed: number;
  failed: number;
}

/** Outcome panel head figure: "N completed · M failed" across the window. */
export function outcomeTotals(days: DailyBackupPoint[]): OutcomeTotals {
  return days.reduce<OutcomeTotals>(
    (acc, day) => ({ completed: acc.completed + day.completed, failed: acc.failed + day.failed }),
    { completed: 0, failed: 0 },
  );
}

/** Duration panel head figure: latest non-null p95, skipping trailing null days. */
export function latestNonNullP95(days: DailyBackupPoint[]): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const value = days[i]?.p95DurationSeconds;
    if (value != null) return value;
  }
  return null;
}

/** Size panel head figure: window total (MB) across every day. */
export function sizeWindowTotalMb(days: DailyBackupPoint[]): number {
  return days.reduce((sum, day) => sum + day.totalSizeMb, 0);
}
