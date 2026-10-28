import { CronTime } from 'cron';

/** How far ahead of `from` the schedule is inspected. */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** A single gap says nothing about a schedule; two is the least that covers a monthly job. */
const MIN_GAPS = 2;
/** Upper bound on the occurrences visited, so a per-second expression stays cheap. */
const MAX_OCCURRENCES = 1000;

/**
 * Expected seconds between two runs of `expression`: the LARGEST gap between
 * consecutive occurrences over the 7 days after `from`, or null when the
 * expression is invalid or never fires.
 *
 * It is a property of the schedule, not of the moment it is asked: for
 * `0 9,17 * * *` (8 h, then 16 h) the answer is 16 h at any time of day, so a
 * freshness verdict built on it does not flip between morning and evening.
 * At least two gaps are always measured, so a monthly job returns a real gap
 * even though its next runs fall beyond the week.
 *
 * Occurrences are computed in UTC so the result does not depend on the host
 * clock or on a DST change: a daily job is always 86 400 s.
 */
export function cronIntervalSeconds(expression: string, from: Date): number | null {
  try {
    const cronTime = new CronTime(expression);
    const horizon = from.getTime() + HORIZON_MS;
    let current = cronTime.getNextDateFrom(from, 'UTC').toMillis();
    let largestMs = 0;
    let gaps = 0;

    for (let visited = 1; visited < MAX_OCCURRENCES; visited += 1) {
      if (current > horizon && gaps >= MIN_GAPS) break;
      const next = cronTime.getNextDateFrom(new Date(current), 'UTC').toMillis();
      const gapMs = next - current;
      if (!Number.isFinite(gapMs) || gapMs <= 0) return null;
      largestMs = Math.max(largestMs, gapMs);
      gaps += 1;
      current = next;
    }

    return gaps > 0 ? largestMs / 1000 : null;
  } catch {
    return null;
  }
}
