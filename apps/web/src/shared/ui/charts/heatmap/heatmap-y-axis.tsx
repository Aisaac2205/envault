"use client";

// Vendored from the @bklit registry (ui.bklit.com/r/heatmap-chart.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Changes: the `cn` import points at @/shared/lib/cn. One prop, tagged "envault:" below: `labels`
// (the weekday names were fixed to English, Sunday first).

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { useHeatmap } from "./heatmap-context";
import {
  formatHeatmapYAxisLabel,
  getHeatmapDayLabels,
  type HeatmapYAxisLabelFormat,
  type HeatmapYAxisTickFilter,
  resolveHeatmapRowOpacity,
  shouldShowHeatmapYAxisTick,
} from "./heatmap-utils";

export interface HeatmapYAxisProps {
  /** Additional class name for labels */
  className?: string;
  /** Which row ticks to display. Default: `"odd"` (Mon / Wed / Fri). */
  tickFilter?: HeatmapYAxisTickFilter;
  /** Label format — `"initial"` shows the first letter only (Mon → M). Default: `"full"`. */
  labelFormat?: HeatmapYAxisLabelFormat;
  /** Per-row label opacity — mirrors {@link HeatmapCells} `rowOpacity`. */
  rowOpacity?: number | readonly number[];
  /**
   * envault: one label per display row, already in the language of the page and in
   * the order of the rows (so they already start on the week start day). Default:
   * the registry's English names.
   */
  labels?: readonly string[];
}

export const HeatmapYAxis = memo(function HeatmapYAxis({
  className,
  tickFilter = "odd",
  labelFormat = "full",
  rowOpacity,
  labels: rowLabels,
}: HeatmapYAxisProps) {
  const { containerRef, margin, binHeight, gap, yScale, weekStartDay } =
    useHeatmap();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const labels = useMemo(
    () =>
      (rowLabels ?? getHeatmapDayLabels(weekStartDay))
        .map((label, row) => ({
          row,
          label: formatHeatmapYAxisLabel(label, labelFormat),
          y: margin.top + yScale(row) + (binHeight - gap) / 2,
        }))
        .filter((tick) => shouldShowHeatmapYAxisTick(tick.row, tickFilter)),
    [binHeight, gap, labelFormat, margin.top, rowLabels, tickFilter, weekStartDay, yScale]
  );

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  return createPortal(
    labels.map((tick) => (
      <div
        className="pointer-events-none absolute"
        key={tick.row}
        style={{
          top: tick.y,
          left: 4,
          width: Math.max(margin.left - 12, 0),
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          transform: "translateY(-50%)",
        }}
      >
        <span
          className={cn(
            "whitespace-nowrap text-chart-label text-xs",
            className
          )}
          style={{ opacity: resolveHeatmapRowOpacity(tick.row, rowOpacity) }}
        >
          {tick.label}
        </span>
      </div>
    )),
    container
  );
});

HeatmapYAxis.displayName = "HeatmapYAxis";

export default HeatmapYAxis;
