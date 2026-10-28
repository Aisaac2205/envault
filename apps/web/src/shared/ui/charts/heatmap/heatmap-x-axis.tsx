"use client";

// Vendored from the @bklit registry (ui.bklit.com/r/heatmap-chart.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Changes: the `cn` import points at @/shared/lib/cn. Two props, tagged "envault:" below: `locale`
// (the month names were fixed to en-US) and `minLabelGap` (labels of neighbouring months overlapped).

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { useHeatmap } from "./heatmap-context";
import { getHeatmapColumnMonthAnchor } from "./heatmap-utils";

export interface HeatmapXAxisProps {
  /** Additional class name for labels */
  className?: string;
  /** envault: language of the month names. Default: `en-US`, the registry's value. */
  locale?: string;
  /**
   * envault: least distance in px between two month labels. When a month starts a
   * column or two after the previous label (the partial first month of a 90 day
   * window), the earlier label is dropped. Default: 0, which keeps every label.
   */
  minLabelGap?: number;
}


export const HeatmapXAxis = memo(function HeatmapXAxis({
  className,
  locale = "en-US",
  minLabelGap = 0,
}: HeatmapXAxisProps) {
  const { containerRef, data, margin, xScale } = useHeatmap();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const labels = useMemo(() => {
    const monthFmt = new Intl.DateTimeFormat(locale, { month: "short" });
    const ticks: { label: string; x: number; key: string }[] = [];
    let lastMonthKey = "";

    for (let columnIndex = 0; columnIndex < data.length; columnIndex++) {
      const column = data[columnIndex];
      if (!column) {
        continue;
      }

      const monthAnchor = getHeatmapColumnMonthAnchor(column);
      if (!monthAnchor) {
        continue;
      }

      const monthKey = `${monthAnchor.getFullYear()}-${monthAnchor.getMonth()}`;
      if (monthKey === lastMonthKey) {
        continue;
      }

      ticks.push({
        label: monthFmt.format(monthAnchor),
        x: margin.left + xScale(columnIndex),
        key: monthKey,
      });
      lastMonthKey = monthKey;
    }

    // envault: keep the later label when two sit closer than `minLabelGap`.
    if (minLabelGap > 0) {
      const spaced: typeof ticks = [];
      for (const tick of ticks) {
        const previous = spaced.at(-1);
        if (previous && tick.x - previous.x < minLabelGap) {
          spaced.pop();
        }
        spaced.push(tick);
      }
      return spaced;
    }

    return ticks;
  }, [data, locale, margin.left, minLabelGap, xScale]);

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  return createPortal(
    labels.map((tick) => (
      <div
        className="pointer-events-none absolute"
        key={tick.key}
        style={{
          top: 0,
          left: tick.x,
          width: 0,
          display: "flex",
          justifyContent: "flex-start",
        }}
      >
        <span
          className={cn(
            "whitespace-nowrap text-chart-label text-xs",
            className
          )}
        >
          {tick.label}
        </span>
      </div>
    )),
    container
  );
});

HeatmapXAxis.displayName = "HeatmapXAxis";

export default HeatmapXAxis;
