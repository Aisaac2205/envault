import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, Line } from "@/shared/ui/charts/line-chart";
import { Grid } from "@/shared/ui/charts/grid";
import { ChartTooltip } from "@/shared/ui/charts/chart-tooltip";
import { chartCssVars } from "@/shared/ui/charts/chart-context";
import type { ChartStatus } from "@/shared/ui/charts/chart-phase";
import { DailyTooltipContent } from "./DailyTooltipContent";
import { mapDurationRows, latestNonNullP95 } from "../../lib/trends-data";
import { DAILY_PANEL_HEIGHTS, getDailyMargin, formatDurationCell, toChartRows } from "../../lib/chart-layout";
import type { DailyBackupPoint } from "../../types";

export interface DurationPanelProps {
  days: DailyBackupPoint[];
  status: ChartStatus;
  revealSignature: string;
  animationDuration?: number;
}

/**
 * Duration chart: p50/p95 as two lines. A `null` day (no completed jobs)
 * renders as a real gap, never interpolated to zero — the vendored `Line`'s
 * `defined` patch (S1) plus `mapDurationRows` keeping `null` handle this.
 */
export function DurationPanel({ days, status, revealSignature, animationDuration }: DurationPanelProps) {
  const { t } = useTranslation("dashboard");
  const rows = useMemo(() => mapDurationRows(days), [days]);
  const figure = useMemo(() => formatDurationCell(latestNonNullP95(days)), [days]);
  const pointByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-chart-1" />
            {t("analytics.duration.p50")}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-chart-2" />
            {t("analytics.duration.p95")}
          </span>
        </div>
        <span className="font-mono tabular-nums text-muted-foreground">{figure}</span>
      </div>
      <LineChart
        data={toChartRows(rows)}
        xDataKey="date"
        aspectRatio={undefined}
        style={{ height: DAILY_PANEL_HEIGHTS.duration }}
        margin={getDailyMargin()}
        revealSignature={revealSignature}
        animationDuration={animationDuration}
        status={status}
      >
        <Grid horizontal numTicksRows={2} />
        <Line dataKey="p50" stroke={chartCssVars.linePrimary} strokeWidth={2} />
        <Line dataKey="p95" stroke={chartCssVars.lineSecondary} strokeWidth={2} />
        <ChartTooltip
          content={({ point }) => {
            const original = pointByDate.get(point.date as string);
            return original ? <DailyTooltipContent point={original} /> : null;
          }}
        />
      </LineChart>
    </div>
  );
}
