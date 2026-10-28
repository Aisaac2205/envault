import { describe, it, expect } from "vitest";
import type { DailyBackupPoint } from "../../types";
import {
  activeQuickRange,
  ALL_CONNECTIONS,
  defaultBrushRange,
  findLatestDayWithData,
  hasDurationData,
  parseDay,
  QUICK_RANGE_DAYS,
  quickRange,
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

function ninetyDays(): DailyBackupPoint[] {
  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 1 + index));
    return day(date.toISOString().slice(0, 10), [1 + index, 2 + index, 3 + index]);
  });
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

describe("defaultBrushRange", () => {
  it("covers the last 30 days of a 90 day window", () => {
    const rows = toDurationRows(ninetyDays());

    const range = defaultBrushRange(rows);

    expect(range?.start).toEqual(rows[60]?.date);
    expect(range?.end).toEqual(rows[89]?.date);
  });

  it("covers the whole series when it has 30 days or fewer", () => {
    const rows = toDurationRows(ninetyDays().slice(0, 12));

    const range = defaultBrushRange(rows);

    expect(range?.start).toEqual(rows[0]?.date);
    expect(range?.end).toEqual(rows[11]?.date);
  });

  it("is null without enough rows to brush", () => {
    expect(defaultBrushRange([])).toBeNull();
    expect(defaultBrushRange(toDurationRows([day("2026-10-25", [1, 1, 1])]))).toBeNull();
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

  it("only looks inside the visible range", () => {
    const rows = toDurationRows([
      day("2026-10-24", [1, 2, 3]),
      day("2026-10-25"),
      day("2026-10-26"),
    ]);

    expect(findLatestDayWithData(rows, { start: rows[1]!.date, end: rows[2]!.date })).toBeNull();
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

describe("quickRange", () => {
  it("offers 7, 30 and 90 days", () => {
    expect(QUICK_RANGE_DAYS).toEqual([7, 30, 90]);
  });

  it("covers the last N days of the window", () => {
    const rows = toDurationRows(ninetyDays());

    const range = quickRange(rows, 7);

    expect(range?.start).toEqual(rows[83]?.date);
    expect(range?.end).toEqual(rows[89]?.date);
  });

  it("shows the whole window for 90 days", () => {
    const rows = toDurationRows(ninetyDays());

    const range = quickRange(rows, 90);

    expect(range?.start).toEqual(rows[0]?.date);
    expect(range?.end).toEqual(rows[89]?.date);
  });
});

describe("activeQuickRange", () => {
  const rows = toDurationRows(ninetyDays());

  it("names the preset whose days the range shows", () => {
    expect(activeQuickRange(rows, quickRange(rows, 7))).toBe(7);
    expect(activeQuickRange(rows, quickRange(rows, 30))).toBe(30);
    expect(activeQuickRange(rows, quickRange(rows, 90))).toBe(90);
  });

  it("matches the days the range shows, not its exact timestamps", () => {
    // A dragged brush edge lands anywhere inside a day; the same days are shown.
    const start = new Date(rows[83]!.date.getTime() - 3 * 60 * 60 * 1000);
    const end = new Date(rows[89]!.date.getTime() + 5 * 60 * 60 * 1000);

    expect(activeQuickRange(rows, { start, end })).toBe(7);
  });

  it("is null for a custom range", () => {
    expect(activeQuickRange(rows, { start: rows[70]!.date, end: rows[85]!.date })).toBeNull();
    expect(activeQuickRange(rows, { start: rows[60]!.date, end: rows[80]!.date })).toBeNull();
  });

  it("is null without a range", () => {
    expect(activeQuickRange(rows, null)).toBeNull();
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
