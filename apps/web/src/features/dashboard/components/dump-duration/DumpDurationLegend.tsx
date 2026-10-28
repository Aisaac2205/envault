import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Legend,
  LegendItem,
  LegendLabel,
  LegendValue,
  useLegendItem,
} from "@/shared/ui/charts/legend";
import type { DurationKey, DurationRow } from "./dump-duration-data";
import { DURATION_SERIES } from "./duration-series";
import { formatDuration } from "./format-duration";
import { LineSwatch } from "./LineSwatch";
import { useDurationLocale } from "./use-duration-locale";

interface DumpDurationLegendProps {
  /** The day whose values the legend shows; `null` shows an em dash for every series. */
  row: DurationRow | null;
  /** The series that is emphasized by click or tap, if any. */
  pinnedKey: DurationKey | null;
  /** Legend index of the series to highlight: the pinned one, or the one under the pointer. */
  highlightedIndex: number | null;
  onTogglePinned: (key: DurationKey) => void;
  onHoverChange: (index: number | null) => void;
}

interface SeriesLegendItemProps {
  pinnedKey: DurationKey | null;
  onTogglePinned: (key: DurationKey) => void;
  formatValue: (value: number) => string;
}

/**
 * One legend entry: the line sample (stroke pattern included), the label and
 * the value. A real button, so it works with a tap, a click or the keyboard.
 */
function SeriesLegendItem({
  pinnedKey,
  onTogglePinned,
  formatValue,
}: SeriesLegendItemProps) {
  const { index } = useLegendItem();
  const series = DURATION_SERIES[index];
  if (!series) {
    return null;
  }

  return (
    <LegendItem
      // A row when the card is narrow (label left, value right), a small block when the three fit side by side.
      className="flex w-full min-w-0 items-center justify-between gap-3 border border-border/70 px-3 py-2 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 aria-pressed:border-text-secondary pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary @xl:w-auto @xl:min-w-44 @xl:flex-col @xl:items-start @xl:justify-start @xl:gap-1"
      onClick={() => onTogglePinned(series.key)}
      pressed={pinnedKey === series.key}
    >
      <span className="flex items-center gap-2">
        <LineSwatch series={series} />
        <LegendLabel className="text-xs font-medium" />
      </span>
      <LegendValue
        className="text-base font-semibold tabular-nums text-legend-foreground"
        formatValue={formatValue}
      />
    </LegendItem>
  );
}

/**
 * The original bklit legend, with a line sample instead of the round dot so a
 * series is never told apart by color alone. It shows each series' value for
 * one day; clicking an item emphasizes that series on the chart.
 */
export function DumpDurationLegend({
  row,
  pinnedKey,
  highlightedIndex,
  onTogglePinned,
  onHoverChange,
}: DumpDurationLegendProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();

  // The legend wants a number; a day without data is NaN, which reads as an em dash.
  const items = useMemo(
    () =>
      DURATION_SERIES.map((series) => ({
        label: t(series.labelKey),
        value: row?.[series.key] ?? Number.NaN,
        color: series.color,
      })),
    [row, t],
  );
  const formatValue = useMemo(
    () => (value: number) => formatDuration(value, locale),
    [locale],
  );

  return (
    <Legend
      className="grid grid-cols-1 gap-1.5 @xl:flex @xl:flex-row @xl:flex-wrap @xl:gap-2"
      hoveredIndex={highlightedIndex}
      items={items}
      onHoverChange={onHoverChange}
    >
      <SeriesLegendItem
        formatValue={formatValue}
        onTogglePinned={onTogglePinned}
        pinnedKey={pinnedKey}
      />
    </Legend>
  );
}
