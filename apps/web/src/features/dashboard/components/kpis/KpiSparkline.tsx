import { BarSparkline } from "@/shared/ui/charts/sparkline";
import type { DayValue } from "./kpi-data";

/** Tall enough to read a trend, short enough to stay a glance. */
export const SPARKLINE_HEIGHT = 44;

interface KpiSparklineProps {
  series: DayValue[];
  /** A CSS color: a chart token, never a status color. */
  color: string;
  /** The day under the pointer, or `null` when it leaves. */
  onHoverChange: (index: number | null) => void;
}

/**
 * The daily bars behind a KPI. The card's figure and caption carry the numbers,
 * so the plot is hidden from assistive technology and only adds the shape.
 */
export function KpiSparkline({ series, color, onHoverChange }: KpiSparklineProps) {
  return (
    <div aria-hidden="true" className="w-full">
      <BarSparkline
        barGap={2}
        barRadius={3}
        color={color}
        data={series}
        dataKey="value"
        height={SPARKLINE_HEIGHT}
        onHoverChange={(index) => onHoverChange(index)}
      />
    </div>
  );
}
