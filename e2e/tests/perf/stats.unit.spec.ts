import { expect, test } from '@playwright/test';
import {
  formatBytes,
  formatDuration,
  mean,
  percentile,
  round,
  stddev,
  summarize,
  throughputMiBps,
  toMiB,
} from '../../support/perf/stats';

// Unit tests of the statistics helpers. They need no stack: the perf config runs
// them first (project `perf-unit`) and the measurements only start if they pass.
// The expected values are worked out by hand in the comments.

test.describe('percentile (linear interpolation, R-7)', () => {
  test('returns the median of an odd and an even sample', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    // rank (4 - 1) * 0.5 = 1.5: halfway between 2 and 3
    expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
  });

  test('is the minimum at 0 and the maximum at 100', () => {
    expect(percentile([7, 3, 9], 0)).toBe(3);
    expect(percentile([7, 3, 9], 100)).toBe(9);
  });

  test('interpolates between the closest ranks', () => {
    // rank 99 * 0.95 = 94.05 over 1..100: 95 + 0.05 * (96 - 95)
    const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(hundred, 95)).toBeCloseTo(95.05, 10);
    // rank 99 * 0.99 = 98.01: 99 + 0.01 * (100 - 99)
    expect(percentile(hundred, 99)).toBeCloseTo(99.01, 10);
    // rank 4 * 0.95 = 3.8: with five samples p95 is 80% of the way from the fourth to the largest
    expect(percentile([10, 20, 30, 40, 50], 95)).toBeCloseTo(48, 10);
  });

  test('does not depend on the order of the input and does not change it', () => {
    const input = [30, 10, 20];
    expect(percentile(input, 50)).toBe(20);
    expect(input).toEqual([30, 10, 20]);
  });

  test('of one value is that value', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  test('rejects an empty sample and a percentile out of range', () => {
    expect(() => percentile([], 50)).toThrow(/empty sample/);
    expect(() => percentile([1, 2], -1)).toThrow(/between 0 and 100/);
    expect(() => percentile([1, 2], 101)).toThrow(/between 0 and 100/);
    expect(() => percentile([1, 2], Number.NaN)).toThrow(/between 0 and 100/);
  });
});

test.describe('mean and standard deviation', () => {
  test('mean is the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(() => mean([])).toThrow(/empty sample/);
  });

  test('stddev is the sample deviation (n - 1)', () => {
    // mean 5, squared distances 9+1+1+1+0+0+4+16 = 32; 32 / 7 = 4.571..., sqrt = 2.138...
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
    // the population deviation of the same values would be exactly 2
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).not.toBeCloseTo(2, 2);
  });

  test('stddev of equal values is 0, and so is the stddev of a single value', () => {
    expect(stddev([3, 3, 3])).toBe(0);
    expect(stddev([8])).toBe(0);
    expect(stddev([])).toBe(0);
  });
});

test('summarize reports every statistic of a sample', () => {
  const summary = summarize([4, 1, 3, 2, 5]);
  expect(summary).toEqual({
    n: 5,
    min: 1,
    p50: 3,
    p95: expect.closeTo(4.8, 10),
    p99: expect.closeTo(4.96, 10),
    max: 5,
    mean: 3,
    stddev: expect.closeTo(Math.sqrt(2.5), 10),
  });
  expect(() => summarize([])).toThrow(/empty sample/);
});

test.describe('throughput and units', () => {
  test('throughput is MiB per second', () => {
    // 100 MiB in 2 s
    expect(throughputMiBps(100 * 1024 * 1024, 2000)).toBe(50);
    // 1,048,576 bytes in 500 ms
    expect(throughputMiBps(1024 * 1024, 500)).toBe(2);
  });

  test('a duration under a millisecond counts as one millisecond instead of dividing by zero', () => {
    expect(throughputMiBps(1024 * 1024, 0)).toBe(1000);
    expect(Number.isFinite(throughputMiBps(1, 0))).toBe(true);
  });

  test('toMiB converts bytes', () => {
    expect(toMiB(5 * 1024 * 1024)).toBe(5);
  });

  test('formatBytes uses binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.50 KiB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MiB');
    expect(formatBytes(520_413_184)).toBe('496 MiB');
    expect(formatBytes(1024 ** 3)).toBe('1.00 GiB');
  });

  test('formatDuration picks the readable unit', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_340)).toBe('12.34 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
  });

  test('round keeps the requested decimals without trailing zeros', () => {
    expect(round(1.23456, 3)).toBe(1.235);
    expect(round(2, 3)).toBe(2);
  });
});
