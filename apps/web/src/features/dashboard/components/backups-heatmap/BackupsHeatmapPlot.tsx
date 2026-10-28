import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import {
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
} from "@/shared/ui/charts/heatmap";
import type { DailyBackupPoint } from "../../types";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { FailureLegend } from "./FailureLegend";
import { HeatmapDayTooltip } from "./HeatmapDayTooltip";
import { FAILURE_LEVEL_STYLES, LOADING_LEVEL_STYLES } from "./failure-scale";
import {
  buildCalendarColumns,
  dayKey,
  weekStartFor,
  weekdayLabels,
} from "./heatmap-data";

/** Room for the weekday names on the left and the month names on top. */
const MARGIN = { top: 24, right: 6, bottom: 0, left: 38 };
/** Gap between cells, in px. */
const GAP = 3;
/** Biggest a cell gets, in px: past this the calendar stops growing and the card keeps the rest. */
const MAX_CELL_PX = 32;
/** Least distance between two month names, so "ago" and "sep" never overlap. */
const MIN_MONTH_GAP_PX = 30;

interface BackupsHeatmapPlotProps {
  days: DailyBackupPoint[];
  loading: boolean;
  /** What the calendar says, for assistive technology; unused while loading. */
  description: string;
}

/**
 * The 90 day calendar and its legend. One cell per UTC day, weeks as columns,
 * weekdays as rows, colored by how many backups failed. While `loading` the same
 * grid pulses empty, so the card does not change size when the data arrives.
 */
export function BackupsHeatmapPlot({ days, loading, description }: BackupsHeatmapPlotProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const weekStart = weekStartFor(locale);

  const columns = useMemo(() => buildCalendarColumns(days, weekStart), [days, weekStart]);
  const byDay = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const rowLabels = useMemo(() => weekdayLabels(locale, weekStart), [locale, weekStart]);
  const maxWidth = MARGIN.left + MARGIN.right + columns.length * MAX_CELL_PX;
  const loadingLabel = t("calendar.loading");

  return (
    <HeatmapInteractionProvider>
      <HeatmapInteractionBoundary className="space-y-4">
        {/* The grid grows with the card up to a cell of MAX_CELL_PX, then stops. */}
        <div
          aria-label={loading ? loadingLabel : description}
          aria-live={loading ? "polite" : undefined}
          className="w-full"
          role={loading ? "status" : "img"}
          style={{ maxWidth }}
        >
          <HeatmapChart
            data={columns}
            gap={GAP}
            layout="fluid"
            levelStyles={loading ? LOADING_LEVEL_STYLES : FAILURE_LEVEL_STYLES}
            loadingLabel={loading ? loadingLabel : undefined}
            margin={MARGIN}
            status={loading ? "loading" : "ready"}
          >
            <HeatmapCells
              activeScale={1.08}
              cornerRadius={4}
              hideGhostCells={false}
              inactiveOpacity={0.5}
            />
            <HeatmapXAxis locale={locale} minLabelGap={MIN_MONTH_GAP_PX} />
            <HeatmapYAxis labels={rowLabels} tickFilter={weekStart === 0 ? "odd" : "even"} />
            <HeatmapTooltip
              formatHeader={(date) =>
                formatDate(date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
              }
              formatLabel={(_, date) => <HeatmapDayTooltip day={byDay.get(dayKey(date))} />}
            />
          </HeatmapChart>
        </div>
        <FailureLegend />
      </HeatmapInteractionBoundary>
    </HeatmapInteractionProvider>
  );
}
