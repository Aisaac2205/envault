import type { DurationSeries } from "./duration-series";

/** A short sample of a series line, so the legend and tooltip show its stroke pattern. */
export function LineSwatch({ series }: { series: DurationSeries }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      focusable="false"
      height="10"
      viewBox="0 0 28 10"
      width="28"
    >
      <line
        stroke={series.color}
        strokeDasharray={series.dasharray}
        strokeLinecap={series.linecap}
        strokeWidth={series.strokeWidth}
        x1="2"
        x2="26"
        y1="5"
        y2="5"
      />
    </svg>
  );
}
