import { EVERY_HOURS_VALUES, EveryHours, MAX_DAY_OF_MONTH, Schedule } from './schedule.types';

const NUMBER_FIELD = /^\d{1,2}$/;
const HOURLY_STEP_FIELD = /^\*\/(\d{1,2})$/;

// Best-effort reverse of buildCronExpression: it recognizes exactly the forms
// the builder emits and answers null for anything else (legacy free-form
// expressions included). Day of week 7 is read as Sunday, like cron does.
export function parseCronExpression(expression: string): Schedule | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = fields;
  if (monthField !== '*') return null;

  const minute = parseNumber(minuteField, 0, 59);
  if (minute === null) return null;

  if (minute === 0 && dayOfMonthField === '*' && dayOfWeekField === '*') {
    const everyHours = parseEveryHours(hourField);
    if (everyHours !== null) return { kind: 'every_hours', everyHours };
  }

  const hour = parseNumber(hourField, 0, 23);
  if (hour === null) return null;
  const time = `${pad(hour)}:${pad(minute)}`;

  if (dayOfMonthField === '*' && dayOfWeekField === '*') {
    return { kind: 'daily', time };
  }

  if (dayOfMonthField === '*') {
    const daysOfWeek = parseDaysOfWeek(dayOfWeekField);
    return daysOfWeek === null ? null : { kind: 'weekly', time, daysOfWeek };
  }

  if (dayOfWeekField === '*') {
    const dayOfMonth = parseNumber(dayOfMonthField, 1, MAX_DAY_OF_MONTH);
    return dayOfMonth === null ? null : { kind: 'monthly', time, dayOfMonth };
  }

  return null;
}

function parseNumber(field: string, min: number, max: number): number | null {
  if (!NUMBER_FIELD.test(field)) return null;
  const value = Number(field);
  return value >= min && value <= max ? value : null;
}

function parseEveryHours(field: string): EveryHours | null {
  if (field === '*') return 1;
  const step = HOURLY_STEP_FIELD.exec(field);
  if (!step) return null;
  const value = Number(step[1]);
  return EVERY_HOURS_VALUES.find((allowed) => allowed === value) ?? null;
}

function parseDaysOfWeek(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(',')) {
    const day = parseNumber(part, 0, 7);
    if (day === null) return null;
    days.add(day === 7 ? 0 : day);
  }
  return [...days].sort((a, b) => a - b);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
