import { describe, expect, it } from "vitest";
import type { DailyBackupPoint } from "../../types";
import { dataPresence, isNothingYet } from "../empty-states/data-presence";

function point(date: string, completed: number, failed: number): DailyBackupPoint {
  return {
    date,
    completed,
    failed,
    p50DurationSeconds: null,
    p95DurationSeconds: null,
    maxDurationSeconds: null,
    totalSizeMb: 0,
  };
}

const QUIET = [point("2026-10-26", 0, 0), point("2026-10-27", 0, 0)];

describe("dataPresence", () => {
  it("is unknown while the connections are loading", () => {
    expect(dataPresence(undefined, QUIET)).toBe("unknown");
    expect(dataPresence(undefined, undefined)).toBe("unknown");
  });

  it("is no-connections when there is none, whatever the backups say", () => {
    expect(dataPresence(0, undefined)).toBe("no-connections");
    expect(dataPresence(0, [point("2026-10-27", 3, 0)])).toBe("no-connections");
  });

  it("is unknown while the 90 days are on their way, once there are connections", () => {
    expect(dataPresence(2, undefined)).toBe("unknown");
  });

  it("is no-backups when no day of the 90 ran a backup, an empty answer included", () => {
    expect(dataPresence(2, QUIET)).toBe("no-backups");
    expect(dataPresence(2, [])).toBe("no-backups");
  });

  it("is active once a day has a completed or a failed backup", () => {
    expect(dataPresence(1, [point("2026-10-26", 0, 0), point("2026-10-27", 1, 0)])).toBe("active");
    expect(dataPresence(1, [point("2026-10-27", 0, 2)])).toBe("active");
  });
});

describe("isNothingYet", () => {
  it("is true only before the first connection or the first backup", () => {
    expect(isNothingYet("no-connections")).toBe(true);
    expect(isNothingYet("no-backups")).toBe(true);
    expect(isNothingYet("active")).toBe(false);
    expect(isNothingYet("unknown")).toBe(false);
  });
});
