/// <reference types="jest" />
import { CronFrequency } from '../../../database/enums/cron-frequency.enum';
import { deriveFrequency } from './derive-frequency';
import { Schedule } from './schedule.types';

describe('deriveFrequency', () => {
  it.each<[string, Schedule, CronFrequency]>([
    ['every hour', { kind: 'every_hours', everyHours: 1 }, CronFrequency.HOURLY],
    ['every 2 hours', { kind: 'every_hours', everyHours: 2 }, CronFrequency.CUSTOM],
    ['every 12 hours', { kind: 'every_hours', everyHours: 12 }, CronFrequency.CUSTOM],
    ['daily', { kind: 'daily', time: '02:00' }, CronFrequency.DAILY],
    ['weekly on one day', { kind: 'weekly', time: '02:00', daysOfWeek: [1] }, CronFrequency.WEEKLY],
    [
      'weekly on the same day listed twice',
      { kind: 'weekly', time: '02:00', daysOfWeek: [1, 1] },
      CronFrequency.WEEKLY,
    ],
    [
      'weekly on several days',
      { kind: 'weekly', time: '02:00', daysOfWeek: [1, 3] },
      CronFrequency.CUSTOM,
    ],
    ['monthly', { kind: 'monthly', time: '02:00', dayOfMonth: 1 }, CronFrequency.CUSTOM],
  ])('maps %s', (_label, schedule, expected) => {
    expect(deriveFrequency(schedule)).toBe(expected);
  });
});
