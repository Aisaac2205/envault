import type { DurationKey } from "./dump-duration-data";

export interface DurationSeries {
  key: DurationKey;
  /** i18n key (dashboard namespace) for the legend and tooltip label. */
  labelKey: string;
  /** Series color: blue median, purple 95th percentile, orange slowest. */
  color: string;
  /** Main chart stroke width in px. The median is the most prominent. */
  strokeWidth: number;
  /** Brush strip stroke width in px. */
  stripStrokeWidth: number;
  /** Stroke pattern, so identity never relies on color alone. Solid when omitted. */
  dasharray?: string;
  /**
   * `butt` keeps the dash and gap lengths of a dashed pattern. `round` is what
   * turns a near zero dash into a dot.
   */
  linecap: "butt" | "round";
}

/** Order is the legend order and the tooltip row order. */
export const DURATION_SERIES: readonly DurationSeries[] = [
  {
    key: "p50",
    labelKey: "duration.series.p50",
    color: "var(--chart-duration-p50)",
    strokeWidth: 2.5,
    stripStrokeWidth: 1,
    linecap: "round",
  },
  {
    key: "p95",
    labelKey: "duration.series.p95",
    color: "var(--chart-duration-p95)",
    strokeWidth: 2,
    stripStrokeWidth: 1,
    dasharray: "6 4",
    linecap: "butt",
  },
  {
    key: "max",
    labelKey: "duration.series.max",
    color: "var(--chart-duration-max)",
    strokeWidth: 2,
    stripStrokeWidth: 1,
    // With the round cap, a near zero dash draws a dot.
    dasharray: "0.1 5",
    linecap: "round",
  },
];

/**
 * Painter's order: the slowest line first and the median last, so the median
 * ends up on top where lines touch.
 */
export const DRAW_ORDER: readonly DurationSeries[] = [...DURATION_SERIES].reverse();

/** Extra width of the card colored halo behind every line, in px. */
export const HALO_EXTRA_WIDTH = 3;

/** Opacity of the series that are not emphasized. */
export const DIMMED_OPACITY = 0.25;

/**
 * The chart numbers its lines in draw order, the legend in series order. This
 * turns a legend index into the matching chart line index.
 */
export function drawIndexOf(legendIndex: number | null): number | null {
  if (legendIndex === null) {
    return null;
  }
  const series = DURATION_SERIES[legendIndex];
  const index = DRAW_ORDER.findIndex((candidate) => candidate.key === series?.key);
  return index === -1 ? null : index;
}
