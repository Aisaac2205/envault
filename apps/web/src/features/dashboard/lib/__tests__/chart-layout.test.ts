import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  revealDuration,
  pickDurationUnit,
  formatDurationValue,
  getDailyMargin,
  DAILY_PANEL_HEIGHTS,
  formatUtcTickDate,
  formatUtcFullDate,
  toChartRows,
} from "../chart-layout";

describe("toChartRows", () => {
  it("preserves every field and row order for the vendored chart's Record<string, unknown>[] data prop", () => {
    const rows = [
      { date: "2026-09-01", completed: 4, failed: 1 },
      { date: "2026-09-02", completed: 0, failed: 0 },
    ];
    expect(toChartRows(rows)).toEqual(rows);
  });
});

describe("revealDuration", () => {
  it("returns 150 on first mount with motion enabled", () => {
    expect(revealDuration({ reducedMotion: false, hasRevealed: false })).toBe(150);
  });

  it("returns 0 when prefers-reduced-motion is set", () => {
    expect(revealDuration({ reducedMotion: true, hasRevealed: false })).toBe(0);
  });

  it("returns 0 on any render after the first (refetch, window change)", () => {
    expect(revealDuration({ reducedMotion: false, hasRevealed: true })).toBe(0);
  });
});

describe("pickDurationUnit", () => {
  it("picks seconds under a minute", () => {
    expect(pickDurationUnit(0)).toBe("s");
    expect(pickDurationUnit(59)).toBe("s");
  });

  it("picks minutes between a minute and an hour", () => {
    expect(pickDurationUnit(60)).toBe("min");
    expect(pickDurationUnit(3599)).toBe("min");
  });

  it("picks hours at or above an hour", () => {
    expect(pickDurationUnit(3600)).toBe("h");
    expect(pickDurationUnit(7200)).toBe("h");
  });
});

describe("formatDurationValue", () => {
  it("formats seconds", () => {
    expect(formatDurationValue(12, "s")).toBe("12s");
  });

  it("formats minutes with one decimal", () => {
    expect(formatDurationValue(90, "min")).toBe("1.5min");
  });

  it("formats hours with one decimal", () => {
    expect(formatDurationValue(5400, "h")).toBe("1.5h");
  });
});

describe("getDailyMargin", () => {
  it("returns the default margin", () => {
    expect(getDailyMargin()).toEqual({ top: 4, right: 48, bottom: 0, left: 40 });
  });

  it("narrows the right margin when compact (below @xl)", () => {
    expect(getDailyMargin({ compact: true })).toEqual({
      top: 4,
      right: 8,
      bottom: 0,
      left: 40,
    });
  });

  it("reserves bottom space only for the bottom-most panel (x-axis)", () => {
    expect(getDailyMargin({ bottomPanel: true })).toEqual({
      top: 4,
      right: 48,
      bottom: 20,
      left: 40,
    });
  });
});

describe("DAILY_PANEL_HEIGHTS", () => {
  it("encodes priority via height: outcome > duration > size", () => {
    expect(DAILY_PANEL_HEIGHTS.outcome).toBeGreaterThan(DAILY_PANEL_HEIGHTS.duration);
    expect(DAILY_PANEL_HEIGHTS.duration).toBeGreaterThan(DAILY_PANEL_HEIGHTS.size);
  });
});

describe("UTC date formatting (off-by-one guard)", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    // UTC-6: a naive `new Date(dateOnlyIso)` formatted without an explicit
    // timeZone rolls the calendar day back by one here — the exact bug
    // dashboard-charts-web's design calls out.
    process.env.TZ = "America/Chicago";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("formatUtcTickDate keeps the UTC calendar day, unlike a naive local formatter", () => {
    const naive = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(new Date("2026-03-01"));
    const guarded = formatUtcTickDate("2026-03-01");

    expect(guarded).not.toBe(naive);
    expect(guarded).toMatch(/\b1\b/);
  });

  it("formatUtcFullDate does not roll back to the previous day at UTC midnight", () => {
    const label = formatUtcFullDate("2026-01-01");
    expect(label).toContain("2026");
    expect(label).toMatch(/\b1\b/);
    expect(label).not.toMatch(/31/);
  });
});
