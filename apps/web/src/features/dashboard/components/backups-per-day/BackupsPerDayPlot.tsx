import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { Bar } from "@/shared/ui/charts/bar";
import { BarChart } from "@/shared/ui/charts/bar-chart";
import { BarXAxis } from "@/shared/ui/charts/bar-x-axis";
import { ChartLegendHoverProvider } from "@/shared/ui/charts/chart-legend-hover";
import { useElementSize } from "@/shared/ui/charts/chart-parent-size";
import { useChartHover } from "@/shared/ui/charts/chart-context";
import { Grid } from "@/shared/ui/charts/grid";
import { ChartTooltip } from "@/shared/ui/charts/tooltip";
import { YAxis } from "@/shared/ui/charts/y-axis";
import { useCanHover } from "../dump-duration/use-can-hover";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { STATUS_SERIES, type StatusKey } from "./backup-status-series";
import {
  barGapFor,
  findLatestActiveDay,
  formatCount,
  formatRate,
  sumBackups,
  successRate,
  type BackupDayRow,
} from "./backups-per-day-data";
import { BackupsPerDayLegend } from "./BackupsPerDayLegend";
import { BackupsPerDayTooltip } from "./BackupsPerDayTooltip";

const MARGIN = { top: 12, right: 12, bottom: 32, left: 36 };
/** The card-colored gap between the two segments of a bar, in px. Put on each `<Bar>`. */
const STACK_GAP = 2;
/** Corner radius of a segment, in px. A segment narrower than twice this rounds fully. */
const SEGMENT_RADIUS = 4;
/** How many x labels fit: few on a phone, one every few days on a wide card. */
const X_LABELS = { base: 4, sm: 8, md: 10, lg: 14, xl: 16 };
const NO_HOVER_LINKING = () => undefined;

interface BackupsPerDayPlotProps {
  rows: BackupDayRow[];
}

/** Reports the row under the pointer, so the legend can show that day's values. */
function HoverRowReporter({ onChange }: { onChange: (row: BackupDayRow | null) => void }) {
  const { tooltipData } = useChartHover();
  const row = (tooltipData?.point as BackupDayRow | undefined) ?? null;

  useEffect(() => {
    onChange(row);
  }, [row, onChange]);

  return null;
}

interface BackupBarsProps {
  rows: BackupDayRow[];
  /** Chart bar index (stack order) to emphasize, or `null` for none. */
  emphasizedIndex: number | null;
  onHoverRowChange: (row: BackupDayRow | null) => void;
}

/** The stacked bars. Memoized: the legend values change with every hovered day. */
const BackupBars = memo(function BackupBars({
  rows,
  emphasizedIndex,
  onHoverRowChange,
}: BackupBarsProps) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const barGap = barGapFor(width - MARGIN.left - MARGIN.right, rows.length);

  // Whole numbers only: a count of backups has no half steps on the axis.
  const tallest = Math.max(1, ...rows.map((row) => row.completed + row.failed));
  const ticks = Math.min(5, tallest);

  return (
    <div ref={ref}>
      <ChartLegendHoverProvider
        hoveredIndex={emphasizedIndex}
        onHoverChange={NO_HOVER_LINKING}
      >
        <BarChart
          animationDuration={reducedMotion ? 0 : undefined}
          aspectRatio=""
          barGap={barGap}
          // touch-pan-y keeps the page scrollable with a finger on the chart.
          className="h-[220px] touch-pan-y md:h-[280px]"
          data={rows}
          margin={MARGIN}
          stackGap={STACK_GAP}
          stacked
          xDataKey="label"
        >
          <Grid horizontal numTicksRows={ticks} />
          {STATUS_SERIES.map((series) => (
            <Bar
              dataKey={series.key}
              fill={series.color}
              key={series.key}
              lineCap={SEGMENT_RADIUS}
              stackGap={STACK_GAP}
            />
          ))}
          <YAxis numTicks={ticks} />
          <BarXAxis maxLabels={X_LABELS} />
          <ChartTooltip
            content={({ point }) => <BackupsPerDayTooltip point={point} />}
            showDots={false}
          />
          <HoverRowReporter onChange={onHoverRowChange} />
        </BarChart>
      </ChartLegendHoverProvider>
    </div>
  );
});

/**
 * Legend with values, the stacked bars and a text summary. Hovering the chart
 * shows that day's values in the legend; clicking a legend item emphasizes
 * its status on the chart.
 */
export function BackupsPerDayPlot({ rows }: BackupsPerDayPlotProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const canHover = useCanHover();

  const [hoveredRow, setHoveredRow] = useState<BackupDayRow | null>(null);
  const [pinnedKey, setPinnedKey] = useState<StatusKey | null>(null);
  const [legendHoverIndex, setLegendHoverIndex] = useState<number | null>(null);

  const togglePinned = useCallback((key: StatusKey) => {
    setPinnedKey((current) => (current === key ? null : key));
    // The pointer is still over the item after a click. Without this, a second
    // click would keep the hover highlight and look like it did nothing.
    setLegendHoverIndex(null);
  }, []);

  const pinnedIndex = pinnedKey
    ? STATUS_SERIES.findIndex((series) => series.key === pinnedKey)
    : null;
  // The pointer wins over the pinned status while it is over a legend item.
  const highlightedIndex = (canHover ? legendHoverIndex : null) ?? pinnedIndex;

  const latest = useMemo(() => findLatestActiveDay(rows), [rows]);
  const legendRow = hoveredRow ?? latest;

  const caption = useMemo(() => {
    if (hoveredRow) {
      return formatDate(hoveredRow.date, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    if (latest) {
      return t("backups.legend.latest", {
        date: formatDate(latest.date, { day: "numeric", month: "short", year: "numeric" }),
      });
    }
    return "";
  }, [hoveredRow, latest, t]);

  const summary = useMemo(() => {
    const total = sumBackups(rows);
    const day = { day: "numeric", month: "short", year: "numeric" } as const;
    return t("backups.chartLabel", {
      from: formatDate(rows[0]?.date, day),
      to: formatDate(rows.at(-1)?.date, day),
      completed: formatCount(total.completed, locale),
      failed: formatCount(total.failed, locale),
      rate: formatRate(successRate(total.completed, total.failed), locale),
    });
  }, [rows, locale, t]);

  return (
    <div className="min-w-0">
      <div
        aria-label={t("backups.legend.label")}
        // A container query: the legend lays out by the card's width, not the screen's.
        className="@container mb-3 space-y-1.5"
        role="group"
      >
        <p className="text-xs text-text-secondary">{caption}</p>
        <BackupsPerDayLegend
          highlightedIndex={highlightedIndex}
          onHoverChange={setLegendHoverIndex}
          onTogglePinned={togglePinned}
          pinnedKey={pinnedKey}
          row={legendRow}
        />
      </div>

      <div aria-label={summary} role="img">
        <BackupBars
          emphasizedIndex={highlightedIndex}
          onHoverRowChange={setHoveredRow}
          rows={rows}
        />
      </div>
    </div>
  );
}
