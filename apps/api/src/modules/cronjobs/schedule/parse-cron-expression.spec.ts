/// <reference types="jest" />
import { buildCronExpression } from './build-cron-expression';
import { parseCronExpression } from './parse-cron-expression';
import { EVERY_HOURS_VALUES, Schedule } from './schedule.types';

describe('parseCronExpression', () => {
  describe('recognized forms', () => {
    it.each<[string, Schedule]>([
      ['0 * * * *', { kind: 'every_hours', everyHours: 1 }],
      ['0 */1 * * *', { kind: 'every_hours', everyHours: 1 }],
      ['0 */2 * * *', { kind: 'every_hours', everyHours: 2 }],
      ['0 */12 * * *', { kind: 'every_hours', everyHours: 12 }],
      ['0 2 * * *', { kind: 'daily', time: '02:00' }],
      ['0 0 * * *', { kind: 'daily', time: '00:00' }],
      ['59 23 * * *', { kind: 'daily', time: '23:59' }],
      ['0 2 * * 1', { kind: 'weekly', time: '02:00', daysOfWeek: [1] }],
      ['30 6 * * 1,3,5', { kind: 'weekly', time: '06:30', daysOfWeek: [1, 3, 5] }],
      ['0 3 1 * *', { kind: 'monthly', time: '03:00', dayOfMonth: 1 }],
      ['0 3 28 * *', { kind: 'monthly', time: '03:00', dayOfMonth: 28 }],
    ])('parses "%s"', (expression, expected) => {
      expect(parseCronExpression(expression)).toEqual(expected);
    });

    it('tolerates surrounding and repeated whitespace', () => {
      expect(parseCronExpression('  0   2  * * *  ')).toEqual({ kind: 'daily', time: '02:00' });
    });

    it('accepts zero-padded numbers', () => {
      expect(parseCronExpression('05 02 * * *')).toEqual({ kind: 'daily', time: '02:05' });
    });
  });

  describe('day of week', () => {
    it('reads 7 as Sunday and normalizes it to 0', () => {
      expect(parseCronExpression('0 2 * * 7')).toEqual({
        kind: 'weekly',
        time: '02:00',
        daysOfWeek: [0],
      });
    });

    it('sorts the days and drops duplicates created by the 0/7 alias', () => {
      expect(parseCronExpression('0 2 * * 7,1,0')).toEqual({
        kind: 'weekly',
        time: '02:00',
        daysOfWeek: [0, 1],
      });
    });
  });

  describe('expressions outside the supported forms', () => {
    it.each([
      ['a legacy step and range mix', '*/7 3-5 * * 2,4'],
      ['every N minutes', '*/5 * * * *'],
      ['a step that is not a divisor of 24', '0 */5 * * *'],
      ['a 24 hour step', '0 */24 * * *'],
      ['an hourly step that does not start on the hour', '30 */2 * * *'],
      ['an hourly minute other than 0', '30 * * * *'],
      ['a day of month past 28', '0 2 29 * *'],
      ['day of month 0', '0 2 0 * *'],
      ['a fixed month', '0 2 1 6 *'],
      ['day of month together with day of week', '0 2 1 * 1'],
      ['a day of week range', '0 2 * * 1-5'],
      ['a day of week name', '0 2 * * MON'],
      ['a day of week above 7', '0 2 * * 8'],
      ['a trailing comma in the days', '0 2 * * 1,'],
      ['hour 24', '0 24 * * *'],
      ['minute 60', '60 2 * * *'],
      ['an hour range', '0 2-4 * * *'],
      ['a list of hours', '0 2,14 * * *'],
      ['a 4 field expression', '0 2 * *'],
      ['a 6 field expression with seconds', '0 0 2 * * *'],
      ['a macro', '@daily'],
      ['an empty string', ''],
      ['only whitespace', '   '],
    ])('returns null for %s', (_label, expression) => {
      expect(parseCronExpression(expression)).toBeNull();
    });
  });

  describe('round trip with buildCronExpression', () => {
    const roundTrip = (schedule: Schedule) => parseCronExpression(buildCronExpression(schedule));

    it.each([...EVERY_HOURS_VALUES])('restores every %i hour(s)', (everyHours) => {
      const schedule: Schedule = { kind: 'every_hours', everyHours };

      expect(roundTrip(schedule)).toEqual(schedule);
    });

    it('restores a daily schedule at every minute of the day', () => {
      for (let hour = 0; hour < 24; hour++) {
        for (let minute = 0; minute < 60; minute++) {
          const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const schedule: Schedule = { kind: 'daily', time };

          expect(roundTrip(schedule)).toEqual(schedule);
        }
      }
    });

    it('restores a weekly schedule for every non-empty set of days', () => {
      for (let mask = 1; mask < 1 << 7; mask++) {
        const daysOfWeek = [0, 1, 2, 3, 4, 5, 6].filter((day) => mask & (1 << day));
        const schedule: Schedule = { kind: 'weekly', time: '04:15', daysOfWeek };

        expect(roundTrip(schedule)).toEqual(schedule);
      }
    });

    it('returns the days sorted and unique even when they were built from a messy list', () => {
      expect(roundTrip({ kind: 'weekly', time: '04:15', daysOfWeek: [5, 1, 5] })).toEqual({
        kind: 'weekly',
        time: '04:15',
        daysOfWeek: [1, 5],
      });
    });

    it('restores a monthly schedule for every allowed day', () => {
      for (let dayOfMonth = 1; dayOfMonth <= 28; dayOfMonth++) {
        const schedule: Schedule = { kind: 'monthly', time: '23:45', dayOfMonth };

        expect(roundTrip(schedule)).toEqual(schedule);
      }
    });
  });
});
