import { describe, expect, it } from "vitest";
import { formatCount, formatRate, successRate } from "../backup-stats";

describe("successRate", () => {
  it("is completed over completed plus failed", () => {
    expect(successRate(24, 1)).toBeCloseTo(0.96);
    expect(successRate(1, 1)).toBe(0.5);
    expect(successRate(5, 0)).toBe(1);
    expect(successRate(0, 3)).toBe(0);
  });

  it("is null for a day with nothing finished, not 0 or 100", () => {
    expect(successRate(0, 0)).toBeNull();
  });
});

describe("formatRate", () => {
  it("shows an em dash when there is no rate", () => {
    expect(formatRate(null, "es-AR")).toBe("—");
  });

  it("shows whole percents without decimals", () => {
    expect(formatRate(0.96, "en-US")).toBe("96%");
    expect(formatRate(0, "en-US")).toBe("0%");
    expect(formatRate(1, "en-US")).toBe("100%");
  });

  it("keeps one decimal for a rate that is not whole", () => {
    expect(formatRate(2 / 3, "en-US")).toBe("66.6%");
    expect(formatRate(2 / 3, "es-AR")).toBe("66,6%");
  });

  it("never rounds a rate with failures up to 100%", () => {
    // 1 failure in 250 is 99.6%, which must not read as a perfect run.
    expect(formatRate(249 / 250, "en-US")).toBe("99.6%");
    expect(formatRate(999 / 1000, "en-US")).toBe("99.9%");
    expect(formatRate(9999 / 10000, "en-US")).toBe("99.9%");
  });

  it("is not thrown off by floating point at exact tenths", () => {
    expect(formatRate(0.29, "en-US")).toBe("29%");
    expect(formatRate(0.57, "en-US")).toBe("57%");
  });
});

describe("formatCount", () => {
  it("groups thousands by the language", () => {
    expect(formatCount(1234, "en-US")).toBe("1,234");
    expect(formatCount(1234, "es-AR")).toBe("1.234");
  });
});
