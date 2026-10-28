import { describe, expect, it } from "vitest";
import type { ConnectionHealth, ConnectionSchedule, Freshness } from "../../types";
import {
  describeInterval,
  earliestNextRun,
  engineLabel,
  formatSpan,
  sortBySeverity,
  tightestSchedule,
} from "../connections-health/health-data";

function connection(name: string, freshness: Freshness, over: Partial<ConnectionHealth> = {}): ConnectionHealth {
  return {
    connectionId: `id-${name}`,
    connectionName: name,
    environment: "production",
    dbType: "postgres",
    completed: 0,
    failed: 0,
    successRate: null,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    lastBackup: null,
    lastSuccessAt: null,
    schedules: [],
    freshness,
    ...over,
  };
}

function schedule(over: Partial<ConnectionSchedule> = {}): ConnectionSchedule {
  return {
    cronjobId: "cron-1",
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    intervalSeconds: 3_600,
    ...over,
  };
}

describe("sortBySeverity", () => {
  it("puts stale first, then late, unknown and ok, each group by name", () => {
    const sorted = sortBySeverity(
      [
        connection("Zeta", "ok"),
        connection("Mike", "unknown"),
        connection("Bravo", "stale"),
        connection("Alpha", "ok"),
        connection("Delta", "late"),
        connection("Able", "stale"),
        connection("Charlie", "late"),
      ],
      "en-US",
    );

    expect(sorted.map((row) => `${row.freshness}:${row.connectionName}`)).toEqual([
      "stale:Able",
      "stale:Bravo",
      "late:Charlie",
      "late:Delta",
      "unknown:Mike",
      "ok:Alpha",
      "ok:Zeta",
    ]);
  });

  it("orders names the way the active language does, ignoring case and accents, with numbers in order", () => {
    const sorted = sortBySeverity(
      [
        connection("db10", "ok"),
        connection("Éclair", "ok"),
        connection("db2", "ok"),
        connection("eagle", "ok"),
        connection("Zulu", "ok"),
      ],
      "es-AR",
    );

    expect(sorted.map((row) => row.connectionName)).toEqual(["db2", "db10", "eagle", "Éclair", "Zulu"]);
  });

  it("does not change the list it receives", () => {
    const input = [connection("B", "ok"), connection("A", "stale")];

    sortBySeverity(input, "en-US");

    expect(input.map((row) => row.connectionName)).toEqual(["B", "A"]);
  });
});

describe("tightestSchedule", () => {
  it("is the schedule with the smallest interval: the one freshness is judged against", () => {
    const daily = schedule({ cronjobId: "daily", intervalSeconds: 86_400 });
    const hourly = schedule({ cronjobId: "hourly", intervalSeconds: 3_600 });

    expect(tightestSchedule([daily, hourly])).toBe(hourly);
  });

  it("skips schedules without an interval and is null when none has one", () => {
    const broken = schedule({ cronjobId: "broken", intervalSeconds: null });
    const daily = schedule({ cronjobId: "daily", intervalSeconds: 86_400 });

    expect(tightestSchedule([broken, daily])).toBe(daily);
    expect(tightestSchedule([broken])).toBeNull();
    expect(tightestSchedule([])).toBeNull();
  });
});

describe("earliestNextRun", () => {
  it("is the soonest next run across the schedules", () => {
    expect(
      earliestNextRun([
        schedule({ nextRunAt: "2026-10-27T12:00:00.000Z" }),
        schedule({ nextRunAt: null }),
        schedule({ nextRunAt: "2026-10-27T10:00:00.000Z" }),
      ]),
    ).toBe("2026-10-27T10:00:00.000Z");
  });

  it("is null when no schedule has one", () => {
    expect(earliestNextRun([schedule({ nextRunAt: null })])).toBeNull();
    expect(earliestNextRun([])).toBeNull();
  });
});

describe("formatSpan", () => {
  it.each([
    [30, "30 s"],
    [60, "1 min"],
    [90, "1 min 30 s"],
    [2_700, "45 min"],
    [3_600, "1 h"],
    [5_400, "1 h 30 min"],
    [57_600, "16 h"],
    [86_400, "1 d"],
    [129_600, "1 d 12 h"],
    [2_678_400, "31 d"],
  ])("writes %i seconds as %s", (seconds, expected) => {
    expect(formatSpan(seconds)).toBe(expected);
  });
});

describe("describeInterval", () => {
  it.each([
    [900, { kind: "every", span: "15 min", approximate: false }],
    [3_600, { kind: "every", span: "1 h", approximate: false }],
    [21_600, { kind: "every", span: "6 h", approximate: false }],
    [86_400, { kind: "daily", span: "1 d", approximate: false }],
    [604_800, { kind: "weekly", span: "7 d", approximate: false }],
  ])("reads %i seconds as a regular schedule", (seconds, expected) => {
    expect(describeInterval(seconds)).toEqual(expected);
  });

  it.each([
    // 0 9,17 * * *: 8 h and 16 h gaps, the API reports the 16 h one.
    [57_600, "16 h"],
    // 0 */5 * * *: 5 h gaps and a 4 h one at midnight.
    [18_000, "5 h"],
    // */45 * * * *: 45 min and 15 min.
    [2_700, "45 min"],
    // 0 9 * * 1-5: the weekend gap.
    [259_200, "3 d"],
    // A monthly schedule: 28 to 31 days.
    [2_678_400, "31 d"],
  ])("marks %i seconds as the largest gap of an irregular schedule", (seconds, span) => {
    expect(describeInterval(seconds)).toEqual({ kind: "every", span, approximate: true });
  });
});

describe("engineLabel", () => {
  it.each([
    ["postgres", "PG"],
    ["postgresql", "PG"],
    ["mysql", "MySQL"],
    ["MySQL", "MySQL"],
    ["mariadb", "MARIADB"],
  ])("labels %s as %s", (dbType, label) => {
    expect(engineLabel(dbType)).toBe(label);
  });
});
