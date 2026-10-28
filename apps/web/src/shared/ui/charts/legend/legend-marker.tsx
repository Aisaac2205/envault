"use client";

// Vendored from the @bklit registry (ui.bklit.com/r/legend.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Only change: the `cn` import points at @/shared/lib/cn.

import { cn } from "@/shared/lib/cn";
import { useLegendItem } from "./legend-context";

export interface LegendMarkerProps {
  /** Marker size class. Default: "h-2.5 w-2.5" */
  className?: string;
}

export function LegendMarker({ className = "h-2.5 w-2.5" }: LegendMarkerProps) {
  const { item } = useLegendItem();

  // Note: backgroundColor must remain inline style as item.color is dynamic data
  return (
    <div
      className={cn("shrink-0 rounded-full", className)}
      style={{ backgroundColor: item.color }}
    />
  );
}

LegendMarker.displayName = "LegendMarker";
