import type { DurationKey } from "./dump-duration-data";

export interface DurationSeries {
  key: DurationKey;
  /** i18n key (dashboard namespace) for the legend and tooltip label. */
  labelKey: string;
  /** Series color: an ordinal blue ramp, darkest = median. */
  color: string;
  /** Main chart stroke width in px. The median is the most prominent. */
  strokeWidth: number;
  /** Brush strip stroke width in px. */
  stripStrokeWidth: number;
  /** Stroke pattern, so identity never relies on color alone. Solid when omitted. */
  dasharray?: string;
}

/** Order is the legend order and the tooltip row order. */
export const DURATION_SERIES: readonly DurationSeries[] = [
  {
    key: "p50",
    labelKey: "duration.series.p50",
    color: "var(--chart-duration-p50)",
    strokeWidth: 2,
    stripStrokeWidth: 1,
  },
  {
    key: "p95",
    labelKey: "duration.series.p95",
    color: "var(--chart-duration-p95)",
    strokeWidth: 1.5,
    stripStrokeWidth: 1,
    dasharray: "6 4",
  },
  {
    key: "max",
    labelKey: "duration.series.max",
    color: "var(--chart-duration-max)",
    strokeWidth: 1.5,
    stripStrokeWidth: 1,
    // With the round line cap, a near zero dash draws a dot.
    dasharray: "0.5 4.5",
  },
];
