import { describe, it, expect } from "vitest";
import type { DailyBackupPoint } from "../../types";
import {
  ALL_CONNECTIONS,
  DEFAULT_RANGE_DAYS,
  findLatestDayWithData,
  hasDurationData,
  parseDay,
  QUICK_RANGE_DAYS,
  toConnectionId,
  toDurationRows,
} from "../dump-duration/dump-duration-data";

function day(
  date: string,
  durations: [number | null, number | null, number | null] = [null, null, null],
): DailyBackupPoint {
  return {
    date,
    completed: durations[0] === null ? 0 : 1,
    failed: 0,
    p50DurationSeconds: durations[0],
    p95DurationSeconds: durations[1],
    maxDurationSeconds: durations[2],
    totalSizeMb: 0,
  };
}

describe("parseDay", () => {
  it("returns local midnight of the same calendar day, in any timezone", () => {
    const parsed = parseDay("2026-10-27");

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(9);
    expect(parsed.getDate()).toBe(27);
    expect(parsed.getHours()).toBe(0);
  });
});

describe("toDurationRows", () => {
  it("keeps null durations as null so the line breaks instead of dropping to 0", () => {
    const rows = toDurationRows([
      day("2026-10-25", [2.5, 4, 6]),
      day("2026-10-26"),
      day("2026-10-27", [3, 5, 7]),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1]?.p50).toBeNull();
    expect(rows[1]?.p95).toBeNull();
    expect(rows[1]?.max).toBeNull();
    expect(rows[0]).toMatchObject({ p50: 2.5, p95: 4, max: 6 });
    expect(rows[2]).toMatchObject({ p50: 3, p95: 5, max: 7 });
  });

  it("maps the API fields to the series keys", () => {
    const [row] = toDurationRows([day("2026-10-25", [1, 2, 3])]);

    expect(row?.date).toBeInstanceOf(Date);
    expect(row).toMatchObject({ p50: 1, p95: 2, max: 3 });
  });

  it("returns an empty list for an empty series", () => {
    expect(toDurationRows([])).toEqual([]);
  });
});

describe("hasDurationData", () => {
  it("is false when no day has a completed backup", () => {
    expect(hasDurationData(toDurationRows([day("2026-10-25"), day("2026-10-26")]))).toBe(false);
    expect(hasDurationData([])).toBe(false);
  });

  it("is true as soon as one day has a duration", () => {
    expect(
      hasDurationData(toDurationRows([day("2026-10-25"), day("2026-10-26", [1, 1, 1])])),
    ).toBe(true);
  });

  it("counts a day with only some of the three durations", () => {
    expect(hasDurationData(toDurationRows([day("2026-10-25", [null, 3, null])]))).toBe(true);
    expect(hasDurationData(toDurationRows([day("2026-10-25", [null, null, 9])]))).toBe(true);
    expect(hasDurationData(toDurationRows([day("2026-10-25", [2, null, null])]))).toBe(true);
  });
});

describe("findLatestDayWithData", () => {
  it("skips trailing empty days", () => {
    const rows = toDurationRows([
      day("2026-10-24", [1, 2, 3]),
      day("2026-10-25", [4, 5, 6]),
      day("2026-10-26"),
    ]);

    expect(findLatestDayWithData(rows)?.p50).toBe(4);
  });

  it("counts a day with only some of the three durations", () => {
    const rows = toDurationRows([
      day("2026-10-24", [1, 2, 3]),
      day("2026-10-25", [null, null, 9]),
      day("2026-10-26"),
    ]);

    expect(findLatestDayWithData(rows)?.max).toBe(9);
  });
});

describe("quick ranges", () => {
  it("offers 7, 30 and 90 days", () => {
    expect(QUICK_RANGE_DAYS).toEqual([7, 30, 90]);
  });

  it("starts on 30 days", () => {
    expect(DEFAULT_RANGE_DAYS).toBe(30);
  });
});

describe("toConnectionId", () => {
  it("maps the all-connections option to no filter", () => {
    expect(toConnectionId(ALL_CONNECTIONS)).toBeUndefined();
  });

  it("passes a connection id through", () => {
    expect(toConnectionId("7f4a1c2e-0000-4000-8000-000000000001")).toBe(
      "7f4a1c2e-0000-4000-8000-000000000001",
    );
  });
});
