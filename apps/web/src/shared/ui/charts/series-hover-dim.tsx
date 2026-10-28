"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useChartHover } from "./chart-context";
import { useChartLegendHover } from "./chart-legend-hover";

interface SeriesHoverDimProps {
  /** Master switch: `false` skips every dim, legend emphasis included. */
  enabled?: boolean;
  /**
   * Dim on chart hover and brush drags. Default: true. `false` keeps only the
   * legend emphasis. (envault: added on top of the vendored bklit source.)
   */
  dimOnChartHover?: boolean;
  /** Opacity to fade to while the chart is being hovered. */
  dimOpacity?: number;
  /** Tween duration in seconds. */
  durationSec?: number;
  /** Series index for multi-series legend hover dimming. */
  seriesIndex?: number;
  /** Stable chart visuals — area fill, stroke line, dashed tail, etc. */
  children: ReactNode;
}

/**
 * Wraps stable series visuals with a hover-driven opacity animation.
 *
 * The wrapper subscribes to chart hover state internally so the parent (Area /
 * Line) can stay on the stable context slice. Children come in as a React prop:
 * because the parent is not re-rendering on hover, the children element
 * reference stays identical and React skips re-rendering them when this
 * wrapper re-renders. That keeps expensive subtrees (`SeriesDashTailOverlay`
 * and its `getPointAtLength` binary search) quiescent on cursor motion.
 */
export function SeriesHoverDim({
  enabled = true,
  dimOnChartHover = true,
  dimOpacity = 0.5,
  // envault: 0.2 s, not 0.4 s. A legend click should answer at once.
  durationSec = 0.2,
  seriesIndex,
  children,
}: SeriesHoverDimProps) {
  const { tooltipData, selection } = useChartHover();
  const { hoveredIndex: legendHoveredIndex } = useChartLegendHover();
  const isChartHovering = tooltipData !== null || selection?.active === true;
  const isLegendDimmed =
    legendHoveredIndex !== null &&
    seriesIndex !== undefined &&
    legendHoveredIndex !== seriesIndex;
  const reducedMotion = useReducedMotion();
  // envault: `enabled` turns every dim off. A chart can keep the legend dim
  // without the chart hover dim through `dimOnChartHover={false}`.
  const opacity =
    enabled && ((dimOnChartHover && isChartHovering) || isLegendDimmed)
      ? dimOpacity
      : 1;
  return (
    <motion.g
      animate={{ opacity }}
      initial={{ opacity: 1 }}
      transition={{
        duration: reducedMotion ? 0 : durationSec,
        ease: "easeInOut",
      }}
    >
      {children}
    </motion.g>
  );
}

SeriesHoverDim.displayName = "SeriesHoverDim";

export default SeriesHoverDim;
