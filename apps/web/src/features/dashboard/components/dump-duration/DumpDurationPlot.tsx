import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { curveMonotoneX } from "@visx/curve";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { ChartBrush, type ChartBrushSelection } from "@/shared/ui/charts/chart-brush";
import { ChartLegendHoverProvider } from "@/shared/ui/charts/chart-legend-hover";
import { chartCssVars, useChartHover } from "@/shared/ui/charts/chart-context";
import { filterDataByXDomain } from "@/shared/ui/charts/filter-data-by-x-domain";
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
import { useTouchBrush } from "./use-touch-brush";

const MAIN_MARGIN = { top: 12, right: 12, bottom: 32, left: 52 };
/** Same left/right margins as the main chart, so the brush lines up with its x axis. */
const STRIP_MARGIN = { top: 6, right: 12, bottom: 6, left: 52 };
/** Tall enough that the brush body is far above the 44px touch target size. */
const STRIP_HEIGHT = 72;
/** Invisible drag target, centred on each brush edge, sized for a finger. */
const BRUSH_HANDLE_PX = 44;

/** Halo in the card color: a line that crosses another one stays separable. */
const HALO = { color: chartCssVars.background, extraWidth: HALO_EXTRA_WIDTH };
/** What the series that are not emphasized dim to. */
const DIMMED = { dimOpacity: DIMMED_OPACITY };
const NO_HOVER_LINKING = () => undefined;

interface DumpDurationPlotProps {
  rows: DurationRow[];
  /** The days the chart shows, or `null` when there are too few to brush. */
  range: ChartBrushSelection | null;
  /**
   * Changes whenever a preset moves the range. The brush only reads its start
   * position when it mounts, so a new value remounts it at the new range.
   */
  brushEpoch: number;
  onRangeChange: (range: ChartBrushSelection | null) => void;
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
  range: ChartBrushSelection | null;
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
  range,
  emphasizedDrawIndex,
  onHoverRowChange,
}: DurationLinesProps) {
  const locale = useDurationLocale();
  const reducedMotion = useReducedMotion();

  const xDomain = useMemo<[Date, Date] | undefined>(
    () => (range ? [range.start, range.end] : undefined),
    [range],
  );

  // The date axis and the hover pill read one label per visible row, so they
  // are formatted here with the active language instead of the chart's en-US.
  const labels = useMemo(() => {
    const visible = range
      ? filterDataByXDomain(
          rows,
          [range.start, range.end],
          (row) => row.date as Date,
        )
      : rows;
    const dayMonth = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
    });
    return visible.map((row) => dayMonth.format(row.date as Date));
  }, [rows, range, locale]);

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
        margin={MAIN_MARGIN}
        // pan-y keeps the page scrollable with a finger on the chart; the
        // default "none" would trap vertical scrolling over the whole card.
        style={{ touchAction: "pan-y" }}
        tweenYDomainOnXDomainChange={!reducedMotion}
        xDataKey="date"
        xDomain={xDomain}
        xDomainSlotCount={rows.length}
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

interface DurationBrushProps {
  rows: DurationRow[];
  range: ChartBrushSelection | null;
  brushEpoch: number;
  onRangeChange: (range: ChartBrushSelection | null) => void;
}

/** The overview strip with the brush that picks which days the main chart shows. */
const DurationBrush = memo(function DurationBrush({
  rows,
  range,
  brushEpoch,
  onRangeChange,
}: DurationBrushProps) {
  const touchBrush = useTouchBrush();

  return (
    <LineChart
      animationDuration={0}
      aspectRatio=""
      data={rows}
      margin={STRIP_MARGIN}
      style={{ height: STRIP_HEIGHT }}
      xDataKey="date"
      yDomainTween={false}
    >
      {DRAW_ORDER.map((series) => (
        <Line
          animate={false}
          curve={curveMonotoneX}
          dataKey={series.key}
          fadeEdges={false}
          key={series.key}
          showHighlight={false}
          stroke={series.color}
          strokeDasharray={series.dasharray}
          strokeLinecap={series.linecap}
          strokeWidth={series.stripStrokeWidth}
        />
      ))}
      <ChartBrush
        handleSize={BRUSH_HANDLE_PX}
        initialSelection={range}
        key={brushEpoch}
        onSelectionChange={onRangeChange}
        useWindowMoveEvents={!touchBrush}
      />
    </LineChart>
  );
});

/**
 * Legend with values, the duration lines and the brush strip. Hovering the
 * chart shows that day's values in the legend; clicking a legend item
 * emphasizes its line.
 */
export function DumpDurationPlot({
  rows,
  range,
  brushEpoch,
  onRangeChange,
}: DumpDurationPlotProps) {
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

  const latest = useMemo(() => findLatestDayWithData(rows, range), [rows, range]);
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
    return t("duration.legend.empty");
  }, [hoveredRow, latest, t]);

  const summary = useMemo(() => {
    const first = range?.start ?? rows[0]?.date;
    const last = range?.end ?? rows.at(-1)?.date;
    const day = { day: "numeric", month: "short", year: "numeric" } as const;
    const from = formatDate(first, day);
    const to = formatDate(last, day);
    if (!latest) {
      return t("duration.chartLabelEmpty", { from, to });
    }
    return t("duration.chartLabel", {
      from,
      to,
      date: formatDate(latest.date, day),
      p50: formatDuration(latest.p50, locale),
      p95: formatDuration(latest.p95, locale),
      max: formatDuration(latest.max, locale),
    });
  }, [rows, range, latest, locale, t]);

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
          range={range}
          rows={rows}
        />
      </div>

      <div
        aria-label={t("duration.brush.label")}
        className="mt-2"
        role="group"
      >
        <DurationBrush
          brushEpoch={brushEpoch}
          onRangeChange={onRangeChange}
          range={range}
          rows={rows}
        />
      </div>
    </div>
  );
}
