import { describe, it, expect } from "vitest";
import i18n from "@/i18n";
import type { Schedule } from "../../types";
import {
  changeScheduleKind,
  DEFAULT_SCHEDULE,
  SCHEDULE_PRESETS,
  describeSchedule,
  findPreset,
  scheduleEquals,
} from "../schedule";

const tEn = i18n.getFixedT("en", "cronjobs");
const tEs = i18n.getFixedT("es", "cronjobs");

const everySixHours: Schedule = { kind: "every_hours", everyHours: 6 };
const mondayWednesdayFriday: Schedule = {
  kind: "weekly",
  time: "09:30",
  daysOfWeek: [1, 3, 5],
};
const weekend: Schedule = { kind: "weekly", time: "10:00", daysOfWeek: [0, 6] };
const everyDayOfWeek: Schedule = {
  kind: "weekly",
  time: "02:00",
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
};
const monthly: Schedule = { kind: "monthly", time: "03:30", dayOfMonth: 15 };

describe("describeSchedule (en)", () => {
  it("describes every hour", () => {
    expect(describeSchedule({ kind: "every_hours", everyHours: 1 }, tEn)).toBe(
      "Every hour",
    );
  });

  it("describes every N hours", () => {
    expect(describeSchedule(everySixHours, tEn)).toBe("Every 6 hours");
  });

  it("describes a daily schedule with the 24h time as-is", () => {
    expect(describeSchedule({ kind: "daily", time: "02:00" }, tEn)).toBe(
      "Every day at 02:00",
    );
    expect(describeSchedule({ kind: "daily", time: "17:45" }, tEn)).toBe(
      "Every day at 17:45",
    );
  });

  it("describes a weekly schedule on one day", () => {
    expect(
      describeSchedule({ kind: "weekly", time: "02:00", daysOfWeek: [1] }, tEn),
    ).toBe("Every Monday at 02:00");
  });

  it("joins several weekdays in plain language", () => {
    expect(describeSchedule(mondayWednesdayFriday, tEn)).toBe(
      "Every Monday, Wednesday and Friday at 09:30",
    );
  });

  it("lists weekdays Monday-first even when Sunday is 0", () => {
    expect(describeSchedule(weekend, tEn)).toBe(
      "Every Saturday and Sunday at 10:00",
    );
  });

  it("reads a weekly schedule on every day as a daily one", () => {
    expect(describeSchedule(everyDayOfWeek, tEn)).toBe("Every day at 02:00");
  });

  it("describes a monthly schedule", () => {
    expect(describeSchedule(monthly, tEn)).toBe(
      "On day 15 of every month at 03:30",
    );
  });

  it("falls back to a generic label for a schedule the builder cannot represent", () => {
    expect(describeSchedule(null, tEn)).toBe("Custom schedule");
  });

  it("falls back to the generic label for a weekly schedule without days", () => {
    expect(
      describeSchedule({ kind: "weekly", time: "02:00", daysOfWeek: [] }, tEn),
    ).toBe("Custom schedule");
  });
});

describe("describeSchedule (es)", () => {
  it("describes every hour and every N hours", () => {
    expect(describeSchedule({ kind: "every_hours", everyHours: 1 }, tEs)).toBe(
      "Cada hora",
    );
    expect(describeSchedule(everySixHours, tEs)).toBe("Cada 6 horas");
  });

  it("describes a daily schedule", () => {
    expect(describeSchedule({ kind: "daily", time: "02:00" }, tEs)).toBe(
      "Todos los días a las 02:00",
    );
  });

  it("describes weekly schedules with Spanish weekday names", () => {
    expect(
      describeSchedule({ kind: "weekly", time: "02:00", daysOfWeek: [1] }, tEs),
    ).toBe("Cada lunes a las 02:00");
    expect(describeSchedule(mondayWednesdayFriday, tEs)).toBe(
      "Cada lunes, miércoles y viernes a las 09:30",
    );
    expect(describeSchedule(weekend, tEs)).toBe(
      "Cada sábado y domingo a las 10:00",
    );
  });

  it("reads a weekly schedule on every day as a daily one", () => {
    expect(describeSchedule(everyDayOfWeek, tEs)).toBe(
      "Todos los días a las 02:00",
    );
  });

  it("describes a monthly schedule", () => {
    expect(describeSchedule(monthly, tEs)).toBe(
      "El día 15 de cada mes a las 03:30",
    );
  });

  it("falls back to a generic label for a schedule the builder cannot represent", () => {
    expect(describeSchedule(null, tEs)).toBe("Programación personalizada");
  });
});

describe("describeSchedule output", () => {
  const everything: Array<Schedule | null> = [
    { kind: "every_hours", everyHours: 1 },
    everySixHours,
    { kind: "daily", time: "02:00" },
    mondayWednesdayFriday,
    everyDayOfWeek,
    monthly,
    null,
  ];

  it.each([
    ["en", tEn],
    ["es", tEs],
  ])("never exposes cron formulas or jargon in %s", (_lng, t) => {
    for (const schedule of everything) {
      const text = describeSchedule(schedule, t);
      expect(text).not.toMatch(/cron/i);
      expect(text).not.toMatch(/[*/]/);
    }
  });
});

describe("schedule presets", () => {
  it("expresses the presets as plain schedule objects", () => {
    expect(SCHEDULE_PRESETS.map((p) => [p.id, p.schedule])).toEqual([
      ["hourly", { kind: "every_hours", everyHours: 1 }],
      ["daily", { kind: "daily", time: "02:00" }],
      ["weekly", { kind: "weekly", time: "02:00", daysOfWeek: [1] }],
    ]);
  });

  it("defaults to the daily preset", () => {
    expect(DEFAULT_SCHEDULE).toEqual({ kind: "daily", time: "02:00" });
    expect(findPreset(DEFAULT_SCHEDULE)?.id).toBe("daily");
  });

  it("finds the preset a schedule equals", () => {
    expect(findPreset({ kind: "every_hours", everyHours: 1 })?.id).toBe(
      "hourly",
    );
    expect(
      findPreset({ kind: "weekly", time: "02:00", daysOfWeek: [1] })?.id,
    ).toBe("weekly");
  });

  it("finds no preset for anything else", () => {
    expect(findPreset(everySixHours)).toBeUndefined();
    expect(findPreset({ kind: "daily", time: "03:00" })).toBeUndefined();
    expect(
      findPreset({ kind: "weekly", time: "02:00", daysOfWeek: [1, 2] }),
    ).toBeUndefined();
    expect(findPreset(null)).toBeUndefined();
  });
});

describe("scheduleEquals", () => {
  it("compares schedules of the same kind field by field", () => {
    expect(scheduleEquals(everySixHours, { ...everySixHours })).toBe(true);
    expect(
      scheduleEquals(everySixHours, { kind: "every_hours", everyHours: 8 }),
    ).toBe(false);
    expect(
      scheduleEquals({ kind: "daily", time: "02:00" }, { kind: "daily", time: "02:00" }),
    ).toBe(true);
    expect(
      scheduleEquals({ kind: "daily", time: "02:00" }, { kind: "daily", time: "02:30" }),
    ).toBe(false);
    expect(scheduleEquals(monthly, { ...monthly })).toBe(true);
    expect(scheduleEquals(monthly, { ...monthly, dayOfMonth: 16 })).toBe(false);
  });

  it("treats different kinds as different even when they run alike", () => {
    expect(
      scheduleEquals(
        { kind: "daily", time: "02:00" },
        { kind: "weekly", time: "02:00", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(false);
  });

  it("ignores the order of the weekdays", () => {
    expect(
      scheduleEquals(mondayWednesdayFriday, {
        ...mondayWednesdayFriday,
        daysOfWeek: [5, 1, 3],
      }),
    ).toBe(true);
    expect(
      scheduleEquals(mondayWednesdayFriday, {
        ...mondayWednesdayFriday,
        daysOfWeek: [1, 3],
      }),
    ).toBe(false);
  });

  it("only equals null to null", () => {
    expect(scheduleEquals(null, null)).toBe(true);
    expect(scheduleEquals(null, everySixHours)).toBe(false);
    expect(scheduleEquals(everySixHours, null)).toBe(false);
  });
});

describe("changeScheduleKind", () => {
  it("starts every-few-hours at a sensible interval", () => {
    expect(changeScheduleKind({ kind: "daily", time: "07:30" }, "every_hours")).toEqual(
      { kind: "every_hours", everyHours: 6 },
    );
  });

  it("carries the time over to the kinds that have one", () => {
    const daily: Schedule = { kind: "daily", time: "07:30" };

    expect(changeScheduleKind(daily, "weekly")).toEqual({
      kind: "weekly",
      time: "07:30",
      daysOfWeek: [1],
    });
    expect(changeScheduleKind(daily, "monthly")).toEqual({
      kind: "monthly",
      time: "07:30",
      dayOfMonth: 1,
    });
  });

  it("falls back to the default time when the schedule had none", () => {
    expect(changeScheduleKind(everySixHours, "daily")).toEqual({
      kind: "daily",
      time: "02:00",
    });
    expect(changeScheduleKind(null, "monthly")).toEqual({
      kind: "monthly",
      time: "02:00",
      dayOfMonth: 1,
    });
  });

  it("keeps the schedule when the kind does not change", () => {
    expect(changeScheduleKind(mondayWednesdayFriday, "weekly")).toBe(
      mondayWednesdayFriday,
    );
  });
});
