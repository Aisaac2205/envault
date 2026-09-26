import { describe, it, expect } from "vitest";
import {
  mapOutcomeRows,
  mapDurationRows,
  mapSizeRows,
  outcomeTotals,
  latestNonNullP95,
  sizeWindowTotalMb,
} from "../trends-data";
import type { DailyBackupPoint } from "../../types";

const days: DailyBackupPoint[] = [
  { date: "2026-09-01", completed: 4, failed: 1, p50DurationSeconds: 10, p95DurationSeconds: 20, totalSizeMb: 100 },
  { date: "2026-09-02", completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
  { date: "2026-09-03", completed: 3, failed: 2, p50DurationSeconds: 8, p95DurationSeconds: 18, totalSizeMb: 60 },
];

describe("mapOutcomeRows", () => {
  it("keeps a zero-count day as a real zero value, not omitted or null", () => {
    const rows = mapOutcomeRows(days);
    expect(rows[1]).toEqual({ date: "2026-09-02", completed: 0, failed: 0 });
  });

  it("maps completed/failed straight through for every day", () => {
    expect(mapOutcomeRows(days)).toEqual([
      { date: "2026-09-01", completed: 4, failed: 1 },
      { date: "2026-09-02", completed: 0, failed: 0 },
      { date: "2026-09-03", completed: 3, failed: 2 },
    ]);
  });
});

describe("mapDurationRows", () => {
  it("preserves a null p50/p95 day as null, never coerced to 0", () => {
    const rows = mapDurationRows(days);
    expect(rows[1]).toEqual({ date: "2026-09-02", p50: null, p95: null });
  });
});

describe("mapSizeRows", () => {
  it("maps totalSizeMb to size for every day, including zero", () => {
    expect(mapSizeRows(days)).toEqual([
      { date: "2026-09-01", size: 100 },
      { date: "2026-09-02", size: 0 },
      { date: "2026-09-03", size: 60 },
    ]);
  });
});

describe("outcomeTotals", () => {
  it("sums completed and failed across the window", () => {
    expect(outcomeTotals(days)).toEqual({ completed: 7, failed: 3 });
  });

  it("returns zeros for an empty window", () => {
    expect(outcomeTotals([])).toEqual({ completed: 0, failed: 0 });
  });
});

describe("latestNonNullP95", () => {
  it("returns the most recent day's p95 when it is non-null", () => {
    expect(latestNonNullP95(days)).toBe(18);
  });

  it("skips trailing null days and returns the latest non-null value", () => {
    const trailingNull: DailyBackupPoint[] = [
      ...days,
      { date: "2026-09-04", completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
    ];
    expect(latestNonNullP95(trailingNull)).toBe(18);
  });

  it("returns null when every day is null", () => {
    expect(latestNonNullP95([days[1]])).toBeNull();
  });
});

describe("sizeWindowTotalMb", () => {
  it("sums totalSizeMb across the window", () => {
    expect(sizeWindowTotalMb(days)).toBe(160);
  });
});
