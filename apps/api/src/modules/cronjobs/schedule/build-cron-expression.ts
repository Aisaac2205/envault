import { Schedule } from './schedule.types';

// Assumes a valid schedule: ScheduleDto enforces the ranges at the API boundary.
export function buildCronExpression(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'every_hours':
      return schedule.everyHours === 1 ? '0 * * * *' : `0 */${schedule.everyHours} * * *`;
    case 'daily': {
      const { hour, minute } = splitTime(schedule.time);
      return `${minute} ${hour} * * *`;
    }
    case 'weekly': {
      const { hour, minute } = splitTime(schedule.time);
      const days = [...new Set(schedule.daysOfWeek)].sort((a, b) => a - b);
      return `${minute} ${hour} * * ${days.join(',')}`;
    }
    case 'monthly': {
      const { hour, minute } = splitTime(schedule.time);
      return `${minute} ${hour} ${schedule.dayOfMonth} * *`;
    }
  }
}

// Numbers, not the padded text, so "07:05" becomes the cron fields 7 and 5.
function splitTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour, minute };
}
