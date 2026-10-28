import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Legend, LegendItem, LegendLabel, useLegendItem } from "@/shared/ui/charts/legend";
import { useHeatmapInteraction } from "@/shared/ui/charts/heatmap";
import { HeatmapLegendSwatch } from "@/shared/ui/charts/heatmap/heatmap-legend-swatch";
import { FAILURE_LEVELS, FAILURE_LEVEL_STYLES } from "./failure-scale";

/** One entry: the swatch the cells use (hatch included) and its word. */
function LevelItem() {
  const { index } = useLegendItem();
  const style = FAILURE_LEVEL_STYLES[index];
  if (!style) return null;

  return (
    <LegendItem className="flex cursor-default items-center gap-2 px-1.5 py-1">
      <HeatmapLegendSwatch cellSize={14} cornerRadius={4} level={index} style={style} />
      <LegendLabel className="text-xs font-medium" />
    </LegendItem>
  );
}

/**
 * The original bklit legend in its compact form: a swatch and a word for each
 * kind of day, with no values (the tooltip has them). Pointing at an entry dims
 * the other days on the calendar, and pointing at a day lights up its entry.
 */
export function FailureLegend() {
  const { t } = useTranslation("dashboard");
  const { hoveredLegendLevel, tooltipData, setHoveredLegendLevel, setHoveredCell, setTooltipData } =
    useHeatmapInteraction();

  const items = useMemo(
    () =>
      FAILURE_LEVELS.map(({ level, labelKey }) => ({
        id: String(level),
        label: t(labelKey),
        value: 0,
        color: FAILURE_LEVEL_STYLES[level]?.color ?? "transparent",
      })),
    [t],
  );

  // A cell's count is its level, so a hovered day lights up its own entry.
  const highlighted = hoveredLegendLevel ?? tooltipData?.count ?? null;

  return (
    <div aria-label={t("calendar.legend.label")} role="group">
      <Legend
        className="flex-row flex-wrap gap-x-1.5 gap-y-1"
        hoveredIndex={highlighted}
        items={items}
        onHoverChange={(index) => {
          setHoveredLegendLevel(index);
          if (index !== null) {
            setHoveredCell(null);
            setTooltipData(null);
          }
        }}
      >
        <LevelItem />
      </Legend>
    </div>
  );
}
