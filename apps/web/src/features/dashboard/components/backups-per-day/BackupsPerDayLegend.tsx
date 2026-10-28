import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Legend,
  LegendItem,
  LegendLabel,
  LegendValue,
  useLegendItem,
} from "@/shared/ui/charts/legend";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { STATUS_SERIES, type StatusKey } from "./backup-status-series";
import { StatusMarker } from "./StatusMarker";
import {
  formatCount,
  formatRate,
  successRate,
  type BackupDayRow,
} from "./backups-per-day-data";

interface BackupsPerDayLegendProps {
  /** The day whose values the legend shows. */
  row: BackupDayRow | null;
  /** The status that is emphasized by click or tap, if any. */
  pinnedKey: StatusKey | null;
  /** Legend index of the status to highlight: the pinned one, or the one under the pointer. */
  highlightedIndex: number | null;
  onTogglePinned: (key: StatusKey) => void;
  onHoverChange: (index: number | null) => void;
}

interface StatusLegendItemProps {
  pinnedKey: StatusKey | null;
  onTogglePinned: (key: StatusKey) => void;
  formatValue: (value: number) => string;
}

/**
 * One legend entry: the marker (color, glyph), the word and the count. A real
 * button, so it works with a tap, a click or the keyboard.
 */
function StatusLegendItem({ pinnedKey, onTogglePinned, formatValue }: StatusLegendItemProps) {
  const { index } = useLegendItem();
  const series = STATUS_SERIES[index];
  if (!series) {
    return null;
  }

  return (
    <LegendItem
      // A row when the card is narrow (label left, value right), a small block when the tiles fit side by side.
      className="flex w-full min-w-0 items-center justify-between gap-3 border border-border/70 px-3 py-2 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 aria-pressed:border-text-secondary pointer-coarse:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary @xl:w-auto @xl:min-w-40 @xl:flex-col @xl:items-start @xl:justify-start @xl:gap-1"
      onClick={() => onTogglePinned(series.key)}
      pressed={pinnedKey === series.key}
    >
      <span className="flex items-center gap-2">
        <StatusMarker series={series} />
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
 * The original bklit legend with a status marker (color plus glyph) instead of
 * the round dot. It shows each status' count for one day, and a third tile with
 * that day's success rate. Clicking a status emphasizes it on the chart.
 */
export function BackupsPerDayLegend({
  row,
  pinnedKey,
  highlightedIndex,
  onTogglePinned,
  onHoverChange,
}: BackupsPerDayLegendProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();

  const items = useMemo(
    () =>
      STATUS_SERIES.map((series) => ({
        id: series.key,
        label: t(series.labelKey),
        value: row?.[series.key] ?? 0,
        color: series.color,
      })),
    [row, t],
  );
  const formatValue = useMemo(
    () => (value: number) => formatCount(value, locale),
    [locale],
  );
  const rate = row ? successRate(row.completed, row.failed) : null;

  return (
    <div className="grid grid-cols-1 gap-1.5 @xl:flex @xl:flex-row @xl:flex-wrap @xl:gap-2">
      {/* `contents`: the two status tiles and the rate tile share one flex row. */}
      <Legend
        className="contents"
        hoveredIndex={highlightedIndex}
        items={items}
        onHoverChange={onHoverChange}
      >
        <StatusLegendItem
          formatValue={formatValue}
          onTogglePinned={onTogglePinned}
          pinnedKey={pinnedKey}
        />
      </Legend>
      <div className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 @xl:w-auto @xl:min-w-40 @xl:flex-col @xl:items-start @xl:justify-start @xl:gap-1">
        <span className="text-xs font-medium text-text-secondary">{t("backups.rate")}</span>
        <span className="text-base font-semibold tabular-nums text-text-primary">
          {formatRate(rate, locale)}
        </span>
      </div>
    </div>
  );
}
