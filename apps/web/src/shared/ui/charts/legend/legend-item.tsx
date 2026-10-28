"use client";

// Vendored from the @bklit registry (ui.bklit.com/r/legend.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Changes: the `cn` import points at @/shared/lib/cn, and `onClick` / `pressed`
// (tagged "envault:" below) let an item be a real toggle button.

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { useLegend, useLegendItem } from "./legend-context";

export interface LegendItemProps {
  /** Container class name */
  className?: string;
  /** Children components (LegendMarker, LegendLabel, LegendValue, LegendProgress) */
  children: ReactNode;
  /**
   * Makes the item a real `<button>`, so a click, tap, Enter or Space works
   * without a mouse. Without it the item stays the hover-only `<div>`.
   * (envault: added on top of the vendored bklit source.)
   */
  onClick?: () => void;
  /**
   * Toggle state of an `onClick` item, exposed as `aria-pressed`.
   * (envault: added on top of the vendored bklit source.)
   */
  pressed?: boolean;
}

export function LegendItem({
  className = "",
  children,
  onClick,
  pressed,
}: LegendItemProps) {
  const { setHoveredIndex } = useLegend();
  const { index, isHovered } = useLegendItem();

  const classes = cn(
    "cursor-pointer rounded-lg px-2 py-1.5 transition-all duration-150 ease-out",
    isHovered && "bg-legend-muted",
    className
  );

  // envault: interactive items are buttons, with the same hover linking.
  if (onClick) {
    return (
      <button
        aria-pressed={pressed}
        className={classes}
        data-hovered={isHovered ? "" : undefined}
        onClick={onClick}
        onMouseEnter={() => setHoveredIndex(index)}
        onMouseLeave={() => setHoveredIndex(null)}
        type="button"
      >
        {children}
      </button>
    );
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Legend item hover interaction
    // biome-ignore lint/a11y/noStaticElementInteractions: Legend item hover interaction
    <div
      className={classes}
      data-hovered={isHovered ? "" : undefined}
      onMouseEnter={() => setHoveredIndex(index)}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      {children}
    </div>
  );
}

LegendItem.displayName = "LegendItem";
