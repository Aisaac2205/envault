import type { ConnectionStorage } from "../../types";

/** How many connections get a slice of their own; the rest fold into "Other". */
export const MAX_CONNECTION_SLICES = 3;

/**
 * The categorical tokens, in order. Only the first three validate as series
 * colors together; `--chart-4` and `--chart-5` are neutrals.
 */
export const SLICE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"] as const;

/** The neutral token of the folded "Other" slice. */
export const OTHER_COLOR = "var(--chart-4)";

export interface StorageSlice {
  /** The connection id, or `other`. The legend keys its items by it. */
  id: string;
  label: string;
  /** Stored size in MB. */
  value: number;
  color: string;
  backupCount: number;
  isOther: boolean;
}

export interface StorageLabels {
  /** Name for a connection whose record no longer exists. */
  deleted: string;
  /** Name of the folded slice, given how many connections it holds. */
  other: (count: number) => string;
}

/**
 * The pie's slices: the three largest connections, then one neutral "Other"
 * with the rest. Connections with nothing stored are left out. The API sends
 * them largest first, but the order is not trusted.
 */
export function toStorageSlices(
  rows: ConnectionStorage[],
  labels: StorageLabels,
): StorageSlice[] {
  const stored = rows
    .filter((row) => row.totalSizeMb > 0)
    .sort((a, b) => b.totalSizeMb - a.totalSizeMb);

  const slices: StorageSlice[] = stored
    .slice(0, MAX_CONNECTION_SLICES)
    .map((row, index) => ({
      id: row.connectionId,
      label: row.connectionName?.trim() ? row.connectionName : labels.deleted,
      value: row.totalSizeMb,
      color: SLICE_COLORS[index] ?? OTHER_COLOR,
      backupCount: row.backupCount,
      isOther: false,
    }));

  const rest = stored.slice(MAX_CONNECTION_SLICES);
  if (rest.length > 0) {
    slices.push({
      id: "other",
      label: labels.other(rest.length),
      value: rest.reduce((sum, row) => sum + row.totalSizeMb, 0),
      color: OTHER_COLOR,
      backupCount: rest.reduce((sum, row) => sum + row.backupCount, 0),
      isOther: true,
    });
  }
  return slices;
}

/** A slice's share of the total: `30%`, `<1%` for a sliver, `—` without a total. */
export function formatShare(value: number, total: number, locale: string): string {
  if (!(total > 0)) {
    return "—";
  }
  const share = value / total;
  const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  if (share > 0 && share < 0.01) {
    return `<${format.format(0.01)}`;
  }
  return format.format(share);
}
