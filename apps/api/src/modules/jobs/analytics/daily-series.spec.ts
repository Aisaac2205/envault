import { buildUtcDayRange, parseDailyRow, zeroFillDailySeries } from './daily-series';

describe('buildUtcDayRange', () => {
  it('returns exactly N days ascending, including today, for a mid-month UTC date', () => {
    const now = new Date('2026-03-15T12:00:00.000Z');

    const days = buildUtcDayRange(now, 5);

    expect(days).toEqual(['2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15']);
  });

  it('is stable across a UTC-midnight crossing within the same calendar day', () => {
    const justBeforeMidnight = new Date('2026-03-15T23:59:59.999Z');
    const justAfterMidnight = new Date('2026-03-16T00:00:00.001Z');

    expect(buildUtcDayRange(justBeforeMidnight, 3)).toEqual(['2026-03-13', '2026-03-14', '2026-03-15']);
    expect(buildUtcDayRange(justAfterMidnight, 3)).toEqual(['2026-03-14', '2026-03-15', '2026-03-16']);
  });

  it('crosses a month-end boundary correctly', () => {
    const now = new Date('2026-03-02T00:00:00.000Z');

    const days = buildUtcDayRange(now, 5);

    expect(days).toEqual(['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('includes a leap day when the window crosses one', () => {
    const now = new Date('2028-03-01T00:00:00.000Z');

    const days = buildUtcDayRange(now, 3);

    expect(days).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});

describe('parseDailyRow', () => {
  it('parses bigint-as-string counts into numbers and rounds float fields', () => {
    const parsed = parseDailyRow({
      date: '2026-03-10',
      completed: '3',
      failed: '1',
      p50: 25.449,
      p95: 38.51,
      totalSizeMb: 120.005,
    });

    expect(parsed).toEqual({
      date: '2026-03-10',
      completed: 3,
      failed: 1,
      p50DurationSeconds: 25.4,
      p95DurationSeconds: 38.5,
      totalSizeMb: 120.01,
    });
  });

  it('keeps null percentiles null when no completed job has duration data', () => {
    const parsed = parseDailyRow({
      date: '2026-03-11',
      completed: '0',
      failed: '2',
      p50: null,
      p95: null,
      totalSizeMb: 0,
    });

    expect(parsed.p50DurationSeconds).toBeNull();
    expect(parsed.p95DurationSeconds).toBeNull();
  });
});

describe('zeroFillDailySeries', () => {
  const days = ['2026-03-10', '2026-03-11', '2026-03-12'];

  it('zero-fills a gap day with no matching row', () => {
    const rows = [
      {
        date: '2026-03-10',
        completed: 2,
        failed: 0,
        p50DurationSeconds: 12.5,
        p95DurationSeconds: 20.1,
        totalSizeMb: 50,
      },
    ];

    const series = zeroFillDailySeries(days, rows);

    expect(series).toEqual([
      rows[0],
      { date: '2026-03-11', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
      { date: '2026-03-12', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
    ]);
  });

  it('ignores rows whose date falls outside the requested day range', () => {
    const rows = [
      {
        date: '2026-01-01',
        completed: 99,
        failed: 99,
        p50DurationSeconds: 1,
        p95DurationSeconds: 1,
        totalSizeMb: 1,
      },
    ];

    const series = zeroFillDailySeries(days, rows);

    expect(series.every((day: { completed: number }) => day.completed === 0)).toBe(true);
    expect(series.map((d: { date: string }) => d.date)).toEqual(days);
  });
});
