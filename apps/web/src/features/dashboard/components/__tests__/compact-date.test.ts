import { describe, expect, it } from "vitest";
import { compactDateParts, formatCompactDateTime } from "../compact-date";

describe("formatCompactDateTime", () => {
  const now = new Date(2026, 9, 28, 12, 0);

  it("is the day, the short month and the time, without the year, in the language", () => {
    const date = new Date(2026, 9, 28, 14, 5);

    expect(formatCompactDateTime(date, "es-AR", now)).toMatch(/^28 oct,? 14:05$/);
    expect(formatCompactDateTime(date, "en-US", now)).toMatch(/^Oct 28,? 2:05\s?PM$/);
  });

  it("adds the year only for a date of another year", () => {
    expect(formatCompactDateTime(new Date(2025, 11, 31, 23, 59), "es-AR", now)).toContain("2025");
    expect(formatCompactDateTime(new Date(2026, 0, 2, 9, 0), "es-AR", now)).not.toContain("2026");
  });

  it("is short enough for a narrow column", () => {
    expect(formatCompactDateTime(new Date(2026, 9, 28, 14, 5), "es-AR", now).length).toBeLessThanOrEqual(14);
  });
});

describe("compactDateParts", () => {
  it("splits the day from the time, so a narrow column breaks between them", () => {
    const parts = compactDateParts(new Date(2026, 5, 13, 2, 15), "es-AR", new Date(2026, 9, 28));

    expect(parts).toEqual({ date: "13 jun", time: "02:15" });
  });
});
