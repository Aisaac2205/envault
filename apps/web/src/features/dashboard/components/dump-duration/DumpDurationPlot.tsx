import { useMemo } from "react";
import { curveMonotoneX } from "@visx/curve";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { ChartBrush, type ChartBrushSelection } from "@/shared/ui/charts/chart-brush";
import { filterDataByXDomain } from "@/shared/ui/charts/filter-data-by-x-domain";
import { Grid } from "@/shared/ui/charts/grid";
import { Line, LineChart } from "@/shared/ui/charts/line-chart";
import { ChartTooltip } from "@/shared/ui/charts/tooltip";
import { XAxis } from "@/shared/ui/charts/x-axis";
import { YAxis } from "@/shared/ui/charts/y-axis";
import {
  defaultBrushRange,
  findLatestDayWithData,
  type DurationRow,
} from "./dump-duration-data";
import { DURATION_SERIES } from "./duration-series";
import { DumpDurationTooltip } from "./DumpDurationTooltip";
import { formatAxisDuration, formatDuration } from "./format-duration";
import { useDurationLocale } from "./use-duration-locale";
import { useTouchBrush } from "./use-touch-brush";

const MAIN_MARGIN = { top: 12, right: 12, bottom: 32, left: 52 };
/** Same left/right margins as the main chart, so the brush lines up with its x axis. */
const STRIP_MARGIN = { top: 6, right: 12, bottom: 6, left: 52 };
/** Tall enough that the brush body is far above the 44px touch target size. */
const STRIP_HEIGHT = 72;
/** Invisible drag target, centred on each brush edge, sized for a finger. */
const BRUSH_HANDLE_PX = 44;

interface DumpDurationPlotProps {
  rows: DurationRow[];
  /** The range the user brushed, or `null` for the default (last 30 days). */
  selection: ChartBrushSelection | null;
  onSelectionChange: (selection: ChartBrushSelection | null) => void;
}

/** Trio of duration lines plus the brush strip that picks which days the chart shows. */
export function DumpDurationPlot({
  rows,
  selection,
  onSelectionChange,
}: DumpDurationPlotProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const reducedMotion = useReducedMotion();
  const touchBrush = useTouchBrush();

  const defaultRange = useMemo(() => defaultBrushRange(rows), [rows]);
  const range = selection ?? defaultRange;
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

  const summary = useMemo(() => {
    const first = range?.start ?? rows[0]?.date;
    const last = range?.end ?? rows.at(-1)?.date;
    const day = { day: "numeric", month: "short", year: "numeric" } as const;
    const from = formatDate(first, day);
    const to = formatDate(last, day);
    const latest = findLatestDayWithData(rows, range);
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
  }, [rows, range, locale, t]);

  const formatTick = useMemo(
    () => (seconds: number) => formatAxisDuration(seconds, locale),
    [locale],
  );

  return (
    <div className="min-w-0">
      <div aria-label={summary} role="img">
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
          {DURATION_SERIES.map((series) => (
            <Line
              animate={false}
              curve={curveMonotoneX}
              dataKey={series.key}
              fadeEdges={false}
              key={series.key}
              showHighlight={false}
              stroke={series.color}
              strokeDasharray={series.dasharray}
              strokeWidth={series.strokeWidth}
            />
          ))}
          <YAxis formatLargeNumbers={false} formatValue={formatTick} />
          <XAxis labels={labels} />
          <ChartTooltip
            content={({ point }) => <DumpDurationTooltip point={point} />}
            dateLabels={labels}
          />
        </LineChart>
      </div>

      <div
        aria-label={t("duration.brush.label")}
        className="mt-2"
        role="group"
      >
        <LineChart
          animationDuration={0}
          aspectRatio=""
          data={rows}
          margin={STRIP_MARGIN}
          style={{ height: STRIP_HEIGHT }}
          xDataKey="date"
          yDomainTween={false}
        >
          {DURATION_SERIES.map((series) => (
            <Line
              animate={false}
              curve={curveMonotoneX}
              dataKey={series.key}
              fadeEdges={false}
              key={series.key}
              showHighlight={false}
              stroke={series.color}
              strokeDasharray={series.dasharray}
              strokeWidth={series.stripStrokeWidth}
            />
          ))}
          <ChartBrush
            handleSize={BRUSH_HANDLE_PX}
            initialSelection={range}
            onSelectionChange={onSelectionChange}
            useWindowMoveEvents={!touchBrush}
          />
        </LineChart>
      </div>
    </div>
  );
}
