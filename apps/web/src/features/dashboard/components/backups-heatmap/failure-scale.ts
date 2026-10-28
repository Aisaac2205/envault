import type { HeatmapLevelStyle, HeatmapLevelStyles } from "@/shared/ui/charts/heatmap";
import type { FailureLevel } from "./heatmap-data";

/** The five kinds of day, in the order of the scale (and of the legend). */
export const FAILURE_LEVELS: readonly { level: FailureLevel; labelKey: string }[] = [
  { level: 0, labelKey: "calendar.level.none" },
  { level: 1, labelKey: "calendar.level.clean" },
  { level: 2, labelKey: "calendar.level.few" },
  { level: 3, labelKey: "calendar.level.several" },
  { level: 4, labelKey: "calendar.level.many" },
];

/**
 * A day with no backups is hatched, so it never looks like a day with none
 * failed (a flat lime). The reds get darker with the failures in light mode and
 * brighter in dark mode; the colors are the `--chart-scale-*` tokens.
 */
const NO_BACKUPS: HeatmapLevelStyle = {
  color: "var(--chart-scale-01)",
  fillMode: "pattern",
  pattern: "diagonal",
  patternColor: "var(--chart-scale-pattern-color)",
  patternStrokeWidth: 1.25,
};

const SOLID = (token: string): HeatmapLevelStyle => ({
  color: `var(${token})`,
  fillMode: "solid",
  pattern: "none",
});

export const FAILURE_LEVEL_STYLES: HeatmapLevelStyles = [
  NO_BACKUPS,
  SOLID("--chart-scale-02"),
  SOLID("--chart-scale-03"),
  SOLID("--chart-scale-04"),
  SOLID("--chart-scale-05"),
];

/** While loading, every cell is the empty one: a flat tint pulses better than a hatch. */
export const LOADING_LEVEL_STYLES: HeatmapLevelStyles = [
  SOLID("--chart-scale-01"),
  ...FAILURE_LEVEL_STYLES.slice(1),
] as unknown as HeatmapLevelStyles;
