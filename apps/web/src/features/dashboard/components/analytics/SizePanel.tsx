import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/format";
import { BarChart } from "@/shared/ui/charts/bar-chart";
import { Bar } from "@/shared/ui/charts/bar";
import { Grid } from "@/shared/ui/charts/grid";
import { ChartTooltip } from "@/shared/ui/charts/chart-tooltip";
import { chartCssVars } from "@/shared/ui/charts/chart-context";
import type { ChartStatus } from "@/shared/ui/charts/chart-phase";
import { DailyTooltipContent } from "./DailyTooltipContent";
import { mapSizeRows, sizeWindowTotalMb } from "../../lib/trends-data";
import { DAILY_PANEL_HEIGHTS, getDailyMargin, toChartRows } from "../../lib/chart-layout";
import type { DailyBackupPoint } from "../../types";

export interface SizePanelProps {
  days: DailyBackupPoint[];
  status: ChartStatus;
  revealSignature: string;
  animationDuration?: number;
}

/** Size chart: daily total size (MB) as single-series columns — no legend (single-series rule). */
export function SizePanel({ days, status, revealSignature, animationDuration }: SizePanelProps) {
  const { t } = useTranslation("dashboard");
  const rows = useMemo(() => mapSizeRows(days), [days]);
  const total = useMemo(() => sizeWindowTotalMb(days), [days]);
  const pointByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{t("analytics.size.label")}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {t("analytics.size.figure", { size: `${formatNumber(Math.round(total))} MB` })}
        </span>
      </div>
      <BarChart
        data={toChartRows(rows)}
        xDataKey="date"
        height={DAILY_PANEL_HEIGHTS.size}
        margin={getDailyMargin({ bottomPanel: true })}
        barWidth={24}
        revealSignature={revealSignature}
        animationDuration={animationDuration}
        status={status}
      >
        <Grid horizontal numTicksRows={2} />
        <Bar dataKey="size" fill={chartCssVars.linePrimary} />
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
