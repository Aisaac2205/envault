import { describe, expect, it } from "vitest";
import en from "@/locales/en/dashboard.json";
import es from "@/locales/es/dashboard.json";
import { STATUS_SERIES } from "../backups-per-day/backup-status-series";

describe("STATUS_SERIES labels", () => {
  // The chart owns its keys: the shared chart.* keys belong to BackupStatusChart,
  // which is going away, and removing them must not blank the bar legend.
  it("uses keys owned by the backups per day chart", () => {
    expect(STATUS_SERIES.map((series) => series.labelKey)).toEqual([
      "backups.completed",
      "backups.failed",
    ]);
  });

  it.each([
    ["en", en as Record<string, string>],
    ["es", es as Record<string, string>],
  ])("has every label in the %s locale", (_lang, messages) => {
    for (const series of STATUS_SERIES) {
      expect(messages[series.labelKey]).toEqual(expect.any(String));
    }
  });
});
