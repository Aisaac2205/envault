import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Legend,
  LegendItem,
  LegendLabel,
  useLegendItem,
} from "@/shared/ui/charts/legend";
import type { DurationKey } from "./dump-duration-data";
import { DURATION_SERIES } from "./duration-series";
import { LineSwatch } from "./LineSwatch";

interface DumpDurationLegendProps {
  /** The series that is emphasized by click or tap, if any. */
  pinnedKey: DurationKey | null;
  /** Legend index of the series to highlight: the pinned one, or the one under the pointer. */
  highlightedIndex: number | null;
  onTogglePinned: (key: DurationKey) => void;
  onHoverChange: (index: number | null) => void;
  /**
   * Draws the legend without letting anything reach it (the loading card: there
   * is no chart yet to emphasize). It keeps the layout of the live one.
   */
  inert?: boolean;
}

interface SeriesLegendItemProps {
  pinnedKey: DurationKey | null;
  onTogglePinned: (key: DurationKey) => void;
}

/**
 * One legend entry: the line sample (stroke pattern included) and the label. A
 * real button, so it works with a tap, a click or the keyboard.
 */
function SeriesLegendItem({ pinnedKey, onTogglePinned }: SeriesLegendItemProps) {
  const { index } = useLegendItem();
  const series = DURATION_SERIES[index];
  if (!series) {
    return null;
  }

  return (
    <LegendItem
      className="flex min-w-0 items-center gap-2 border border-border/70 px-3 py-1.5 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 aria-pressed:border-text-secondary pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
      onClick={() => onTogglePinned(series.key)}
      pressed={pinnedKey === series.key}
    >
      <LineSwatch series={series} />
      <LegendLabel className="text-xs font-medium" />
    </LegendItem>
  );
}

/**
 * The original bklit legend, compact: a line sample and a word for each series,
 * so a series is never told apart by color alone. The day's values are in the
 * tooltip, not here. Clicking an entry emphasizes that series on the chart.
 */
export function DumpDurationLegend({
  pinnedKey,
  highlightedIndex,
  onTogglePinned,
  onHoverChange,
  inert = false,
}: DumpDurationLegendProps) {
  const { t } = useTranslation("dashboard");

  const items = useMemo(
    () =>
      DURATION_SERIES.map((series) => ({
        id: series.key,
        label: t(series.labelKey),
        value: 0,
        color: series.color,
      })),
    [t],
  );

  return (
    <div
      aria-label={t("duration.legend.label")}
      className="mb-3"
      inert={inert}
      role="group"
    >
      <Legend
        className="flex-row flex-wrap gap-1.5"
        hoveredIndex={highlightedIndex}
        items={items}
        onHoverChange={onHoverChange}
      >
        <SeriesLegendItem onTogglePinned={onTogglePinned} pinnedKey={pinnedKey} />
      </Legend>
    </div>
  );
}
