import { describe, it, expect } from "vitest";
import { formatAxisDuration, formatDuration } from "../dump-duration/format-duration";

describe("formatDuration", () => {
  it("shows an em dash for a missing value, never 0", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("uses milliseconds below one second", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(0.85)).toBe("850 ms");
    expect(formatDuration(0.9994)).toBe("999 ms");
  });

  it("rolls milliseconds over to seconds instead of printing 1000 ms", () => {
    expect(formatDuration(0.9996)).toBe("1.0 s");
    expect(formatDuration(1)).toBe("1.0 s");
  });

  it("uses one decimal of seconds below one minute", () => {
    expect(formatDuration(12.4)).toBe("12.4 s");
    expect(formatDuration(59.94)).toBe("59.9 s");
  });

  it("rolls seconds over to minutes instead of printing 60.0 s", () => {
    expect(formatDuration(59.96)).toBe("1 m 00 s");
    expect(formatDuration(60)).toBe("1 m 00 s");
  });

  it("uses minutes and zero padded seconds below one hour", () => {
    expect(formatDuration(125)).toBe("2 m 05 s");
    expect(formatDuration(3599.4)).toBe("59 m 59 s");
  });

  it("uses hours and zero padded minutes from one hour", () => {
    expect(formatDuration(3599.6)).toBe("1 h 00 m");
    expect(formatDuration(3725)).toBe("1 h 02 m");
  });

  it("clamps negative values to zero", () => {
    expect(formatDuration(-3)).toBe("0 ms");
  });

  it("follows the locale decimal separator", () => {
    expect(formatDuration(12.4, "es-AR")).toBe("12,4 s");
  });
});

describe("formatAxisDuration", () => {
  it("drops the trailing zero units that clutter axis ticks", () => {
    expect(formatAxisDuration(0)).toBe("0");
    expect(formatAxisDuration(0.2)).toBe("200 ms");
    expect(formatAxisDuration(5)).toBe("5 s");
    expect(formatAxisDuration(2.5)).toBe("2.5 s");
    expect(formatAxisDuration(60)).toBe("1 m");
    expect(formatAxisDuration(90)).toBe("1 m 30 s");
    expect(formatAxisDuration(3600)).toBe("1 h");
  });
});
