import type { ConnectionHealth, ConnectionSchedule, Freshness } from "../../types";

/** Worst first: what needs attention leads the table. */
const SEVERITY: Record<Freshness, number> = {
  stale: 0,
  late: 1,
  unknown: 2,
  ok: 3,
};

/** Rows by severity, then by name in the active language (accents and case ignored, `db2` before `db10`). */
export function sortBySeverity(
  connections: ConnectionHealth[],
  locale: string,
): ConnectionHealth[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...connections].sort(
    (a, b) =>
      SEVERITY[a.freshness] - SEVERITY[b.freshness] ||
      collator.compare(a.connectionName, b.connectionName),
  );
}

/**
 * The schedule freshness is judged against: the one that runs most often.
 * `null` when no schedule has a valid interval.
 */
export function tightestSchedule(schedules: ConnectionSchedule[]): ConnectionSchedule | null {
  let tightest: ConnectionSchedule | null = null;
  for (const schedule of schedules) {
    const interval = schedule.intervalSeconds;
    if (interval === null || !(interval > 0)) continue;
    if (tightest === null || interval < (tightest.intervalSeconds ?? Infinity)) {
      tightest = schedule;
    }
  }
  return tightest;
}

/** The soonest `nextRunAt` among the schedules, or `null` when none is planned. */
export function earliestNextRun(schedules: ConnectionSchedule[]): string | null {
  let earliest: string | null = null;
  for (const { nextRunAt } of schedules) {
    if (nextRunAt === null) continue;
    if (earliest === null || Date.parse(nextRunAt) < Date.parse(earliest)) {
      earliest = nextRunAt;
    }
  }
  return earliest;
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;
const WEEK = 604_800;

/** `45 s`, `15 min`, `1 h 30 min`, `16 h`, `3 d`. The units read the same in English and Spanish. */
export function formatSpan(seconds: number): string {
  const total = Math.round(seconds);
  if (total < MINUTE) return `${total} s`;
  if (total < HOUR) {
    const minutes = Math.floor(total / MINUTE);
    const rest = total % MINUTE;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }
  if (total < DAY) {
    const hours = Math.floor(total / HOUR);
    const minutes = Math.floor((total % HOUR) / MINUTE);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  const days = Math.floor(total / DAY);
  const hours = Math.floor((total % DAY) / HOUR);
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

/**
 * Whether every gap of a schedule with this largest gap is the same. A minute
 * step restarts each hour and an hour step each day, so "every 45 minutes" runs
 * at :00 and :45 (45 min, then 15) and "every 5 hours" leaves a 4 h gap at
 * midnight. Past a day, only whole weeks are regular: a weekday schedule has a
 * 3 day weekend and a monthly one runs every 28 to 31 days.
 */
function isRegular(seconds: number): boolean {
  if (seconds < HOUR) return HOUR % seconds === 0;
  if (seconds < DAY) return seconds % HOUR === 0 && DAY % seconds === 0;
  return seconds === DAY || seconds % WEEK === 0;
}

export type IntervalDescription = {
  kind: "every" | "daily" | "weekly";
  /** The gap, as `formatSpan` writes it. */
  span: string;
  /** True when the gap is the largest of an irregular schedule, not a constant one. */
  approximate: boolean;
};

/** How to word the expected interval the API reports (the largest gap of the schedule). */
export function describeInterval(seconds: number): IntervalDescription {
  const span = formatSpan(seconds);
  if (seconds === DAY) return { kind: "daily", span, approximate: false };
  if (seconds === WEEK) return { kind: "weekly", span, approximate: false };
  return { kind: "every", span, approximate: !isRegular(seconds) };
}

/** The engine chip: `PG` or `MySQL`; any other engine is shown as its upper-cased name. */
export function engineLabel(dbType: string): string {
  const engine = dbType.toLowerCase();
  if (engine === "postgres" || engine === "postgresql") return "PG";
  if (engine === "mysql") return "MySQL";
  return dbType.toUpperCase();
}
