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

  it.each([
    ['08:00', '2026-10-27T08:00:00.000Z'],
    ['09:00 sharp', '2026-10-27T09:00:00.000Z'],
    ['12:00', '2026-10-27T12:00:00.000Z'],
    ['17:00 sharp', '2026-10-27T17:00:00.000Z'],
    ['20:00', '2026-10-27T20:00:00.000Z'],
  ])(
    'is a property of the schedule: 0 9,17 * * * is 16 h at %s UTC (its largest gap), never 8 h',
    (_label, now) => {
      expect(cronIntervalSeconds('0 9,17 * * *', new Date(now))).toBe(16 * 3_600);
    },
  );

  it.each([
    ['0 * * * *', 3_600],
    ['30 2 * * *', 86_400],
    ['0 9 * * 1', 604_800],
  ])('returns the same interval for %s at every time of day', (expression, expected) => {
    for (const hour of ['00:00', '08:00', '12:00', '20:00', '23:59']) {
      expect(cronIntervalSeconds(expression, new Date(`2026-10-27T${hour}:00.000Z`))).toBe(expected);
    }
  });

  it('takes the largest gap of the week for a schedule with several runs a day', () => {
    // 9:00-17:00 every 4 hours, weekdays only: the weekend gap (Fri 17:00 -> Mon 09:00, 64 h) wins.
    expect(cronIntervalSeconds('0 9-17/4 * * 1-5', NOW)).toBe(64 * 3_600);
  });

  it('still returns a positive gap for a monthly schedule, because it always looks at two gaps', () => {
    // 2026-11-15, 2026-12-15 and 2027-01-15: gaps of 30 and 31 days.
    const seconds = cronIntervalSeconds('0 3 15 * *', NOW);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBe(31 * 86_400);
  });

  it('finishes for a very dense schedule by capping the occurrences it inspects', () => {
    expect(cronIntervalSeconds('* * * * * *', NOW)).toBe(1);
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
