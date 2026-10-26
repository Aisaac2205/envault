import { CronFrequency } from '../../../database/enums/cron-frequency.enum';
import { Schedule } from './schedule.types';

// The frequency drives the backup category and the catch-up period, which only
// exist for HOURLY, DAILY and WEEKLY; every other shape is CUSTOM.
export function deriveFrequency(schedule: Schedule): CronFrequency {
  switch (schedule.kind) {
    case 'every_hours':
      return schedule.everyHours === 1 ? CronFrequency.HOURLY : CronFrequency.CUSTOM;
    case 'daily':
      return CronFrequency.DAILY;
    case 'weekly':
      return new Set(schedule.daysOfWeek).size === 1 ? CronFrequency.WEEKLY : CronFrequency.CUSTOM;
    case 'monthly':
      return CronFrequency.CUSTOM;
  }
}
