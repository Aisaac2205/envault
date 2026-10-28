"use client";

// Vendored from the @bklit registry (ui.bklit.com/r/legend.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Only change: the `cn` import points at @/shared/lib/cn.

import { cn } from "@/shared/lib/cn";
import { useLegendItem } from "./legend-context";

export interface LegendLabelProps {
  /** Label class name. Default: "text-sm font-medium" */
  className?: string;
}

export function LegendLabel({
  className = "text-sm font-medium",
}: LegendLabelProps) {
  const { item } = useLegendItem();

  return (
    <span className={cn("text-legend-foreground", className)}>
      {item.label}
    </span>
  );
}

LegendLabel.displayName = "LegendLabel";
