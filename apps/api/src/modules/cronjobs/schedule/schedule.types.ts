// Only divisors of 24: cron's `*/N` restarts at midnight, so any other step
// gives uneven gaps (`*/5` fires at 20:00 and again at 00:00).
export const EVERY_HOURS_VALUES = [1, 2, 3, 4, 6, 8, 12] as const;
export type EveryHours = (typeof EVERY_HOURS_VALUES)[number];

export const SCHEDULE_KINDS = ['every_hours', 'daily', 'weekly', 'monthly'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

// 24h `HH:mm`.
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Every month has a 28th, so a monthly schedule never skips one.
export const MAX_DAY_OF_MONTH = 28;

export interface EveryHoursSchedule {
  kind: 'every_hours';
  everyHours: EveryHours;
}

export interface DailySchedule {
  kind: 'daily';
  time: string;
}

export interface WeeklySchedule {
  kind: 'weekly';
  time: string;
  // 0 = Sunday .. 6 = Saturday.
  daysOfWeek: number[];
}

export interface MonthlySchedule {
  kind: 'monthly';
  time: string;
  dayOfMonth: number;
}

export type Schedule = EveryHoursSchedule | DailySchedule | WeeklySchedule | MonthlySchedule;
