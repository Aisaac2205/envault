import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart } from "@/shared/ui/charts/bar-chart";
import { Bar } from "@/shared/ui/charts/bar";
import { Grid } from "@/shared/ui/charts/grid";
import { ChartTooltip } from "@/shared/ui/charts/chart-tooltip";
import type { ChartStatus } from "@/shared/ui/charts/chart-phase";
import { DailyTooltipContent } from "./DailyTooltipContent";
import { mapOutcomeRows, outcomeTotals } from "../../lib/trends-data";
import { DAILY_PANEL_HEIGHTS, getDailyMargin, toChartRows } from "../../lib/chart-layout";
import type { DailyBackupPoint } from "../../types";

export interface OutcomePanelProps {
  days: DailyBackupPoint[];
  status: ChartStatus;
  revealSignature: string;
  /** 150ms on first mount, 0 for reduced motion or any later render (Motion requirement). */
  animationDuration?: number;
}

/**
 * Outcome chart: completed/failed daily counts as stacked columns, failed at
 * the baseline (Outcome Chart requirement). Zero-count days render as a real
 * zero-height column — `mapOutcomeRows` keeps `0` as a number, never a gap.
 */
export function OutcomePanel({ days, status, revealSignature, animationDuration }: OutcomePanelProps) {
  const { t } = useTranslation("dashboard");
  const rows = useMemo(() => mapOutcomeRows(days), [days]);
  const totals = useMemo(() => outcomeTotals(days), [days]);
  const pointByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-full bg-success" />
            {t("analytics.outcome.completed")}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden="true" className="size-2 rounded-full bg-error" />
            {t("analytics.outcome.failed")}
          </span>
        </div>
        <span className="font-mono tabular-nums text-muted-foreground">
          {t("analytics.outcome.figure", { completed: totals.completed, failed: totals.failed })}
        </span>
      </div>
      <BarChart
        data={toChartRows(rows)}
        xDataKey="date"
        height={DAILY_PANEL_HEIGHTS.outcome}
        margin={getDailyMargin()}
        stacked
        stackGap={2}
        barWidth={24}
        revealSignature={revealSignature}
        animationDuration={animationDuration}
        status={status}
      >
        <Grid horizontal numTicksRows={2} />
        <Bar dataKey="failed" fill="var(--color-error)" />
        <Bar dataKey="completed" fill="var(--color-success)" />
        <ChartTooltip
          content={({ point }) => {
            const original = pointByDate.get(point.date as string);
            return original ? <DailyTooltipContent point={original} /> : null;
          }}
        />
      </BarChart>
    </div>
  );
}
