/**
 * Statistics and unit helpers of the performance suite. Pure functions with no
 * I/O, so they are unit-tested without the stack (tests/perf/stats.unit.spec.ts).
 */

const BYTES_PER_MIB = 1024 * 1024;

export interface Summary {
  /** Number of samples. */
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  /** Sample standard deviation (n - 1 in the denominator); 0 when n = 1. */
  stddev: number;
}

/**
 * The `p`-th percentile (0-100) with linear interpolation between the closest
 * ranks, method R-7: NumPy's default `linear`, Excel's `PERCENTILE.INC`. The
 * sorted sample `x[0..n-1]` is read at the fractional rank `(n - 1) * p / 100`.
 * With n = 5, p95 sits at rank 3.8: 80% of the way from the fourth to the fifth
 * value, so it is almost the maximum. It never invents a value outside the sample.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new RangeError('Cannot take a percentile of an empty sample.');
  }
  if (!(p >= 0 && p <= 100)) {
    throw new RangeError(`A percentile must be between 0 and 100, got ${p}.`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('Cannot take the mean of an empty sample.');
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation; a single value has no spread to measure, so it is 0. */
export function stddev(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const center = mean(values);
  const squares = values.reduce((sum, value) => sum + (value - center) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) {
    throw new RangeError('Cannot summarize an empty sample.');
  }
  return {
    n: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: Math.max(...values),
    mean: mean(values),
    stddev: stddev(values),
  };
}

/**
 * Mebibytes (1 MiB = 1,048,576 bytes) per second. Job timestamps have a
 * resolution of one millisecond, so a shorter duration counts as 1 ms instead
 * of dividing by zero.
 */
export function throughputMiBps(bytes: number, durationMs: number): number {
  return bytes / BYTES_PER_MIB / (Math.max(durationMs, 1) / 1000);
}

export const toMiB = (bytes: number): number => bytes / BYTES_PER_MIB;

/** Binary units: B, KiB, MiB, GiB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

/** `850 ms`, `12.34 s` or `2 min 05 s`, for log lines and prose (tables use plain numbers). */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)} min ${String(totalSeconds % 60).padStart(2, '0')} s`;
}

/** Rounds to `digits` decimals without the trailing zeros that `toFixed` leaves. */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
