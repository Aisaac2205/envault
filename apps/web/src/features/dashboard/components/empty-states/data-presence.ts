import type { DailyBackupPoint } from "../../types";

/**
 * How much the dashboard has to show, which picks the empty state of a card that
 * has nothing to draw. Worked out once, on the page, from what it already reads:
 * the connections and the 90 day series of the backup calendar.
 *
 * - `unknown`: still loading, or the 90 days could not be read.
 * - `no-connections`: there is no connection yet.
 * - `no-backups`: there are connections, but no backup ran in the last 90 days.
 * - `active`: at least one backup ran in the last 90 days.
 */
export type DataPresence = "unknown" | "no-connections" | "no-backups" | "active";

/**
 * `connectionCount` is `undefined` while the connections load; `days` while the
 * 90 days do. Without a connection nothing else matters: no backup can run.
 */
export function dataPresence(
  connectionCount: number | undefined,
  days: DailyBackupPoint[] | undefined,
): DataPresence {
  if (connectionCount === undefined) return "unknown";
  if (connectionCount === 0) return "no-connections";
  if (!Array.isArray(days)) return "unknown";
  return days.some((day) => day.completed + day.failed > 0) ? "active" : "no-backups";
}

/** Nothing has run yet: a card says what will appear here, not what is missing from a range. */
export function isNothingYet(presence: DataPresence): boolean {
  return presence === "no-connections" || presence === "no-backups";
}
