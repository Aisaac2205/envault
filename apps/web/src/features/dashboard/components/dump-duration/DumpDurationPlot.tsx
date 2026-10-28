import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { curveMonotoneX } from "@visx/curve";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { ChartLegendHoverProvider } from "@/shared/ui/charts/chart-legend-hover";
import { chartCssVars, useChartHover } from "@/shared/ui/charts/chart-context";
import { Grid } from "@/shared/ui/charts/grid";
import { Line, LineChart } from "@/shared/ui/charts/line-chart";
import { ChartTooltip } from "@/shared/ui/charts/tooltip";
import { XAxis } from "@/shared/ui/charts/x-axis";
import { YAxis } from "@/shared/ui/charts/y-axis";
import {
  findLatestDayWithData,
  type DurationKey,
  type DurationRow,
} from "./dump-duration-data";
import {
  DIMMED_OPACITY,
  DRAW_ORDER,
  DURATION_SERIES,
  drawIndexOf,
  HALO_EXTRA_WIDTH,
} from "./duration-series";
import { DumpDurationLegend } from "./DumpDurationLegend";
import { DumpDurationTooltip } from "./DumpDurationTooltip";
import { formatAxisDuration, formatDuration } from "./format-duration";
import { useCanHover } from "./use-can-hover";
import { useDurationLocale } from "./use-duration-locale";

const MARGIN = { top: 12, right: 12, bottom: 32, left: 52 };

/** Halo in the card color: a line that crosses another one stays separable. */
const HALO = { color: chartCssVars.background, extraWidth: HALO_EXTRA_WIDTH };
/** What the series that are not emphasized dim to. */
const DIMMED = { dimOpacity: DIMMED_OPACITY };
const NO_HOVER_LINKING = () => undefined;

interface DumpDurationPlotProps {
  /** Every day of the window, oldest first. The chart draws them all. */
  rows: DurationRow[];
}

/** Reports the row under the pointer, so the legend can show that day's values. */
function HoverRowReporter({
  onChange,
}: {
  onChange: (row: DurationRow | null) => void;
}) {
  const { tooltipData } = useChartHover();
  const row = (tooltipData?.point as DurationRow | undefined) ?? null;

  useEffect(() => {
    onChange(row);
  }, [row, onChange]);

  return null;
}

interface DurationLinesProps {
  rows: DurationRow[];
  /** Chart line index (draw order) to emphasize, or `null` for none. */
  emphasizedDrawIndex: number | null;
  onHoverRowChange: (row: DurationRow | null) => void;
}

/**
 * The main chart. Memoized: the legend values change with every hovered day,
 * and the chart must not redraw for that.
 */
const DurationLines = memo(function DurationLines({
  rows,
  emphasizedDrawIndex,
  onHoverRowChange,
}: DurationLinesProps) {
  const locale = useDurationLocale();
  const reducedMotion = useReducedMotion();

  // The date axis and the hover pill read one label per row, so they are
  // formatted here with the active language instead of the chart's en-US.
  const labels = useMemo(() => {
    const dayMonth = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
    });
    return rows.map((row) => dayMonth.format(row.date));
  }, [rows, locale]);

  const formatTick = useMemo(
    () => (seconds: number) => formatAxisDuration(seconds, locale),
    [locale],
  );

  return (
    <ChartLegendHoverProvider
      hoveredIndex={emphasizedDrawIndex}
      onHoverChange={NO_HOVER_LINKING}
    >
      <LineChart
        animationDuration={reducedMotion ? 0 : undefined}
        aspectRatio=""
        className="h-[220px] md:h-[280px]"
        data={rows}
        margin={MARGIN}
        // pan-y keeps the page scrollable with a finger on the chart; the
        // default "none" would trap vertical scrolling over the whole card.
        style={{ touchAction: "pan-y" }}
        xDataKey="date"
        yDomainTweenDuration={reducedMotion ? 0 : undefined}
      >
        <Grid horizontal />
        {DRAW_ORDER.map((series) => (
          <Line
            animate={false}
            curve={curveMonotoneX}
            dataKey={series.key}
            fadeEdges={false}
            halo={HALO}
            highlight={DIMMED}
            key={series.key}
            showHighlight={false}
            stroke={series.color}
            strokeDasharray={series.dasharray}
            strokeLinecap={series.linecap}
            strokeWidth={series.strokeWidth}
          />
        ))}
        <YAxis formatLargeNumbers={false} formatValue={formatTick} />
        <XAxis labels={labels} />
        <ChartTooltip
          content={({ point }) => <DumpDurationTooltip point={point} />}
          dateLabels={labels}
        />
        <HoverRowReporter onChange={onHoverRowChange} />
      </LineChart>
    </ChartLegendHoverProvider>
  );
});

/**
 * Legend with values and the duration lines. Hovering the chart shows that
 * day's values in the legend; clicking a legend item emphasizes its line.
 */
export function DumpDurationPlot({ rows }: DumpDurationPlotProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const canHover = useCanHover();

  const [hoveredRow, setHoveredRow] = useState<DurationRow | null>(null);
  const [pinnedKey, setPinnedKey] = useState<DurationKey | null>(null);
  const [legendHoverIndex, setLegendHoverIndex] = useState<number | null>(null);

  const togglePinned = useCallback((key: DurationKey) => {
    setPinnedKey((current) => (current === key ? null : key));
    // The pointer is still over the item after a click. Without this, a second
    // click would keep the hover highlight and look like it did nothing.
    setLegendHoverIndex(null);
  }, []);

  const pinnedIndex = pinnedKey
    ? DURATION_SERIES.findIndex((series) => series.key === pinnedKey)
    : null;
  // The pointer wins over the pinned series while it is over a legend item.
  const highlightedIndex = (canHover ? legendHoverIndex : null) ?? pinnedIndex;

  const latest = useMemo(() => findLatestDayWithData(rows), [rows]);
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
      return t("duration.legend.latest", {
        date: formatDate(latest.date, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      });
    }
    return "";
  }, [hoveredRow, latest, t]);

  const summary = useMemo(() => {
    const day = { day: "numeric", month: "short", year: "numeric" } as const;
    const from = formatDate(rows[0]?.date, day);
    const to = formatDate(rows.at(-1)?.date, day);
    // The plot only mounts for a window with data, so there is always a latest day.
    if (!latest) {
      return "";
    }
    return t("duration.chartLabel", {
      from,
      to,
      date: formatDate(latest.date, day),
      p50: formatDuration(latest.p50, locale),
      p95: formatDuration(latest.p95, locale),
      max: formatDuration(latest.max, locale),
    });
  }, [rows, latest, locale, t]);

  return (
    <div className="min-w-0">
      <div
        aria-label={t("duration.legend.label")}
        // A container query: the legend lays out by the card's width, not the screen's.
        className="@container mb-3 space-y-1.5"
        role="group"
      >
        <p className="text-xs text-text-secondary">{caption}</p>
        <DumpDurationLegend
          highlightedIndex={highlightedIndex}
          onHoverChange={setLegendHoverIndex}
          onTogglePinned={togglePinned}
          pinnedKey={pinnedKey}
          row={legendRow}
        />
      </div>

      <div aria-label={summary} role="img">
        <DurationLines
          emphasizedDrawIndex={drawIndexOf(highlightedIndex)}
          onHoverRowChange={setHoveredRow}
          rows={rows}
        />
      </div>
    </div>
  );
}
