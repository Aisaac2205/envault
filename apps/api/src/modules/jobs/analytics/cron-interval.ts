import { CronTime } from 'cron';

/**
 * Seconds between the next two occurrences of `expression` after `from`, or
 * null when the expression is invalid or never fires.
 *
 * Occurrences are computed in UTC so the result does not depend on the host
 * clock or on a DST change: a daily job is always 86 400 s. For schedules
 * that are not regular (`0 9,17 * * *`, a monthly job) it is the gap that
 * follows `from`, not an average.
 */
export function cronIntervalSeconds(expression: string, from: Date): number | null {
  try {
    const cronTime = new CronTime(expression);
    const first = cronTime.getNextDateFrom(from, 'UTC');
    const second = cronTime.getNextDateFrom(first.toJSDate(), 'UTC');
    const seconds = (second.toMillis() - first.toMillis()) / 1000;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}
