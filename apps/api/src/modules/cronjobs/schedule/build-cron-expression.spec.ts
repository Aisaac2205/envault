/// <reference types="jest" />
import { CronJob } from 'cron';
import { buildCronExpression } from './build-cron-expression';
import { EVERY_HOURS_VALUES, Schedule } from './schedule.types';

describe('buildCronExpression', () => {
  describe('every_hours', () => {
    it('builds the plain hourly form for every 1 hour', () => {
      expect(buildCronExpression({ kind: 'every_hours', everyHours: 1 })).toBe('0 * * * *');
    });

    it.each([2, 3, 4, 6, 8, 12] as const)('builds a step expression for every %i hours', (n) => {
      expect(buildCronExpression({ kind: 'every_hours', everyHours: n })).toBe(`0 */${n} * * *`);
    });
  });

  describe('daily', () => {
    it.each([
      ['02:00', '0 2 * * *'],
      ['00:00', '0 0 * * *'],
      ['07:05', '5 7 * * *'],
      ['23:59', '59 23 * * *'],
    ])('builds %s as "%s"', (time, expected) => {
      expect(buildCronExpression({ kind: 'daily', time })).toBe(expected);
    });
  });

  describe('weekly', () => {
    it('builds a single day', () => {
      expect(buildCronExpression({ kind: 'weekly', time: '02:00', daysOfWeek: [1] })).toBe(
        '0 2 * * 1',
      );
    });

    it('treats 0 as Sunday and 6 as Saturday', () => {
      expect(buildCronExpression({ kind: 'weekly', time: '00:30', daysOfWeek: [0, 6] })).toBe(
        '30 0 * * 0,6',
      );
    });

    it('emits the days sorted and without duplicates', () => {
      expect(buildCronExpression({ kind: 'weekly', time: '06:30', daysOfWeek: [5, 1, 3, 1] })).toBe(
        '30 6 * * 1,3,5',
      );
    });

    it('does not mutate the days it receives', () => {
      const daysOfWeek = [5, 1];

      buildCronExpression({ kind: 'weekly', time: '06:30', daysOfWeek });

      expect(daysOfWeek).toEqual([5, 1]);
    });
  });

  describe('monthly', () => {
    it.each([
      [1, '0 3 1 * *'],
      [15, '0 3 15 * *'],
      [28, '0 3 28 * *'],
    ])('builds day %i of the month', (dayOfMonth, expected) => {
      expect(buildCronExpression({ kind: 'monthly', time: '03:00', dayOfMonth })).toBe(expected);
    });
  });

  it('only emits expressions the scheduler accepts', () => {
    const schedules: Schedule[] = [
      ...EVERY_HOURS_VALUES.map((everyHours) => ({ kind: 'every_hours' as const, everyHours })),
      { kind: 'daily', time: '23:59' },
      { kind: 'weekly', time: '00:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      { kind: 'monthly', time: '12:34', dayOfMonth: 28 },
    ];

    for (const schedule of schedules) {
      expect(() => new CronJob(buildCronExpression(schedule), () => undefined)).not.toThrow();
    }
  });
});
