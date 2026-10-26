import type { TFunction } from "i18next";
import type { EveryHours, Schedule, ScheduleKind } from "../types";

/**
 * Plain-language helpers for the structured schedule. The API owns the cron
 * expression, so nothing here builds, parses or validates one.
 */

export type ScheduleTranslator = TFunction<"cronjobs">;

// Only the values the API accepts: divisors of 24, so the gaps stay even.
export const EVERY_HOURS_VALUES: readonly EveryHours[] = [1, 2, 3, 4, 6, 8, 12];

export const SCHEDULE_KINDS: readonly ScheduleKind[] = [
  "every_hours",
  "daily",
  "weekly",
  "monthly",
];

// Every month has a 28th, so a monthly schedule never skips one.
export const MAX_DAY_OF_MONTH = 28;

export const DEFAULT_TIME = "02:00";

// Weekday values follow the API (0 = Sunday); people read the week from Monday.
export const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function weekdayName(
  day: number,
  t: ScheduleTranslator,
  length: "long" | "short",
): string {
  return t(`weekday.${length}.${WEEKDAY_KEYS[day]}`);
}

export interface SchedulePreset {
  id: "hourly" | "daily" | "weekly";
  schedule: Schedule;
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: "hourly", schedule: { kind: "every_hours", everyHours: 1 } },
  { id: "daily", schedule: { kind: "daily", time: DEFAULT_TIME } },
  {
    id: "weekly",
    schedule: { kind: "weekly", time: DEFAULT_TIME, daysOfWeek: [1] },
  },
];

export const DEFAULT_SCHEDULE: Schedule = { kind: "daily", time: DEFAULT_TIME };

const DEFAULT_EVERY_HOURS: EveryHours = 6;

/**
 * The builder's starting point for another kind of repeat: the time carries
 * over when both kinds have one, everything else starts at a sensible default.
 */
export function changeScheduleKind(
  current: Schedule | null,
  kind: ScheduleKind,
): Schedule {
  if (current?.kind === kind) return current;
  const time =
    current !== null && current.kind !== "every_hours"
      ? current.time
      : DEFAULT_TIME;
  switch (kind) {
    case "every_hours":
      return { kind, everyHours: DEFAULT_EVERY_HOURS };
    case "daily":
      return { kind, time };
    case "weekly":
      return { kind, time, daysOfWeek: [1] };
    case "monthly":
      return { kind, time, dayOfMonth: 1 };
  }
}

function sameDays(a: number[], b: number[]): boolean {
  const first = new Set(a);
  const second = new Set(b);
  return first.size === second.size && [...first].every((d) => second.has(d));
}

export function scheduleEquals(
  a: Schedule | null,
  b: Schedule | null,
): boolean {
  if (a === null || b === null) return a === b;
  switch (a.kind) {
    case "every_hours":
      return b.kind === "every_hours" && a.everyHours === b.everyHours;
    case "daily":
      return b.kind === "daily" && a.time === b.time;
    case "weekly":
      return (
        b.kind === "weekly" &&
        a.time === b.time &&
        sameDays(a.daysOfWeek, b.daysOfWeek)
      );
    case "monthly":
      return (
        b.kind === "monthly" &&
        a.time === b.time &&
        a.dayOfMonth === b.dayOfMonth
      );
  }
}

export function findPreset(
  schedule: Schedule | null,
): SchedulePreset | undefined {
  return SCHEDULE_PRESETS.find((p) => scheduleEquals(p.schedule, schedule));
}

// "Monday", "Monday and Friday", "Monday, Wednesday and Friday".
function joinList(items: string[], t: ScheduleTranslator): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${t("schedule.listAnd")} ${items[items.length - 1]}`;
}

/**
 * One plain-language sentence for a schedule. Times stay 24h `HH:mm`, as
 * stored, so the text is the same in every browser and locale. `null` is a
 * schedule the builder cannot represent, so it gets a generic label.
 */
export function describeSchedule(
  schedule: Schedule | null,
  t: ScheduleTranslator,
): string {
  if (schedule === null) return t("schedule.custom");
  switch (schedule.kind) {
    case "every_hours":
      return t("schedule.everyHours", { count: schedule.everyHours });
    case "daily":
      return t("schedule.daily", { time: schedule.time });
    case "weekly": {
      const { daysOfWeek, time } = schedule;
      if (daysOfWeek.length === 0) return t("schedule.custom");
      if (new Set(daysOfWeek).size === 7) return t("schedule.daily", { time });
      const days = WEEKDAYS_MONDAY_FIRST.filter((d) => daysOfWeek.includes(d)).map(
        (d) => weekdayName(d, t, "long"),
      );
      return t("schedule.weekly", { days: joinList(days, t), time });
    }
    case "monthly":
      return t("schedule.monthly", {
        day: schedule.dayOfMonth,
        time: schedule.time,
      });
  }
}
