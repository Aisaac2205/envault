import { cronIntervalSeconds } from './cron-interval';

// A Tuesday, 10:30 UTC.
const NOW = new Date('2026-10-27T10:30:00.000Z');

describe('cronIntervalSeconds', () => {
  it.each([
    ['every hour', '0 * * * *', 3_600],
    ['every 6 hours', '0 */6 * * *', 21_600],
    ['every 15 minutes', '*/15 * * * *', 900],
    ['daily', '30 2 * * *', 86_400],
    ['weekly', '0 9 * * 1', 604_800],
    ['every second (six-field expression)', '* * * * * *', 1],
  ])('returns the seconds between two occurrences of a %s schedule', (_label, expression, expected) => {
    expect(cronIntervalSeconds(expression, NOW)).toBe(expected);
  });

  it('measures the next two occurrences after the given instant, so irregular schedules depend on it', () => {
    // 10:30 -> next 17:00, then 09:00 the next day.
    expect(cronIntervalSeconds('0 9,17 * * *', NOW)).toBe(16 * 3_600);
    // 18:00 -> next 09:00, then 17:00 the same day.
    expect(cronIntervalSeconds('0 9,17 * * *', new Date('2026-10-27T18:00:00.000Z'))).toBe(8 * 3_600);
  });

  it('uses the real distance between months for a monthly schedule', () => {
    // 2026-11-15 -> 2026-12-15 is 30 days.
    expect(cronIntervalSeconds('0 3 15 * *', NOW)).toBe(30 * 86_400);
  });

  it('is independent of the clock of the host: occurrences are computed in UTC', () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      // A daily job keeps its 24 h across the 2026-11-01 DST change in New York.
      expect(cronIntervalSeconds('30 1 * * *', new Date('2026-10-31T12:00:00.000Z'))).toBe(86_400);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it.each([
    ['text', 'not a cron'],
    ['too few fields', '* * *'],
    ['an out-of-range field', '61 * * * *'],
    ['an empty string', ''],
    ['a date that never happens', '0 0 31 2 *'],
  ])('returns null for %s', (_label, expression) => {
    expect(cronIntervalSeconds(expression, NOW)).toBeNull();
  });
});
