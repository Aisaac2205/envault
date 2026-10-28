"use client";

// Vendored from the @bklit registry (ui.bklit.com/r/heatmap-chart.json), MIT, bklit/bklit-ui.
// Copied from the registry with curl, because the shadcn CLI ignores the project aliases.
// Copied verbatim.

import { Fragment, memo } from "react";
import { renderPatternPreset } from "../pattern-preset";
import {
  type HeatmapLevelStyles,
  heatmapLevelPatternId,
  heatmapLevelPatternRenderOptions,
  isHeatmapLevelPattern,
} from "./heatmap-colors";

export const HeatmapPatternDefs = memo(function HeatmapPatternDefs({
  levelStyles,
}: {
  levelStyles: HeatmapLevelStyles;
}) {
  const nodes = levelStyles.flatMap((style, level) => {
    if (!isHeatmapLevelPattern(style)) {
      return [];
    }

    const id = heatmapLevelPatternId(level);
    const pattern = style.pattern;
    if (!pattern) {
      return [];
    }

    const node = renderPatternPreset(
      pattern,
      id,
      heatmapLevelPatternRenderOptions(style)
    );

    return node ? [<Fragment key={id}>{node}</Fragment>] : [];
  });

  if (nodes.length === 0) {
    return null;
  }

  return <defs>{nodes}</defs>;
});

HeatmapPatternDefs.displayName = "HeatmapPatternDefs";
