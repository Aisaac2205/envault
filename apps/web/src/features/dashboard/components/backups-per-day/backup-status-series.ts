import { Check, X, type LucideIcon } from "lucide-react";

export type StatusKey = "completed" | "failed";

export interface StatusSeries {
  key: StatusKey;
  /** i18n key (dashboard namespace) for the legend and tooltip label. */
  labelKey: string;
  /**
   * The job state colors. This chart is the one place the series ARE job
   * states, so the reserved status tokens are the right ones.
   */
  color: string;
  /** Glyph in the marker, so the two states never rely on green versus red. */
  Icon: LucideIcon;
}

/** Order is the stack order (completed at the bottom), the legend order and the tooltip order. */
export const STATUS_SERIES: readonly StatusSeries[] = [
  {
    key: "completed",
    labelKey: "chart.completed",
    color: "var(--color-success)",
    Icon: Check,
  },
  {
    key: "failed",
    labelKey: "chart.failed",
    color: "var(--color-error)",
    Icon: X,
  },
];
