import { AreaSparkline, BarSparkline } from "@/shared/ui/charts/sparkline";
import type { DayValue } from "./kpi-data";

/** Tall enough to read a trend, short enough to stay a glance. */
export const SPARKLINE_HEIGHT = 44;

interface KpiSparklineProps {
  kind: "area" | "bar";
  series: DayValue[];
  /** A CSS color: a chart token, never a status color. */
  color: string;
  /** The day under the pointer, or `null` when it leaves. */
  onHoverChange: (index: number | null) => void;
}

/**
 * The daily trend behind a KPI. A day without a value is a gap in the line, not a
 * drop to zero. The card's figure and caption carry the numbers, so the plot is
 * hidden from assistive technology and only adds the shape.
 */
export function KpiSparkline({ kind, series, color, onHoverChange }: KpiSparklineProps) {
  return (
    <div aria-hidden="true" className="w-full">
      {kind === "bar" ? (
        <BarSparkline
          barGap={2}
          barRadius={3}
          color={color}
          data={series}
          dataKey="value"
          height={SPARKLINE_HEIGHT}
          onHoverChange={(index) => onHoverChange(index)}
        />
      ) : (
        <AreaSparkline
          color={color}
          crosshair="dashed"
          curve="monotone"
          data={series}
          dataKey="value"
          dot
          endDot
          fill="gradient"
          fillOpacity={0.32}
          height={SPARKLINE_HEIGHT}
          onHoverChange={(index) => onHoverChange(index)}
          padding={{ top: 6, right: 6, bottom: 4, left: 6 }}
          strokeWidth={2}
        />
      )}
    </div>
  );
}
