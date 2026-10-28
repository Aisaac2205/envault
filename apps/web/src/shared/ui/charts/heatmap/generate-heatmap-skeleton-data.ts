// Vendored from the @bklit registry (ui.bklit.com/r/heatmap-chart.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Copied verbatim.

import type { HeatmapColumn } from "./heatmap-context";

/** Placeholder grid with the same week/day shape as target data (all empty cells). */
export function generateHeatmapSkeletonFromTarget(
  target: HeatmapColumn[]
): HeatmapColumn[] {
  return target.map((column) => ({
    bin: column.bin,
    bins: column.bins.map((bin) => ({
      bin: bin.bin,
      count: 0,
      date: bin.date,
    })),
  }));
}
