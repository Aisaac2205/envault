import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/shared/ui/chart";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { formatDate } from "@/lib/format";
import type { DailyBackupCount } from "../types";

interface BackupAreaChartProps {
  data: DailyBackupCount[];
}

export function BackupAreaChart({ data }: BackupAreaChartProps) {
  const { t } = useTranslation("dashboard");

  const chartConfig: ChartConfig = {
    total: {
      label: t("chart.title", { defaultValue: "Backups completados" }),
      color: "#bfe70a",
    },
    scheduled: {
      label: t("chart.scheduled", { defaultValue: "Programados" }),
      color: "#bfe70a",
    },
    manual: {
      label: t("chart.manual", { defaultValue: "Manuales" }),
      color: "#a1a1aa",
    },
  };

  const chartData = useMemo(() => {
    return data.map((d) => ({
      ...d,
      total: (d.scheduled ?? 0) + (d.manual ?? 0),
    }));
  }, [data]);

  return (
    <Card className="overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-text-primary">
          {t("chart.title", { defaultValue: "Backups completados" })}
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          {t("chart.description", { defaultValue: "Historial reciente de ejecuciones" })}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 pt-2 pb-4 sm:px-6">
        {chartData.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-6 text-muted-foreground/60" />}
            title={t("chart.noData")}
            description={t("chart.noDataDescription")}
            className="h-[220px] py-4"
          />
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <AreaChart
              data={chartData}
              height={220}
              margin={{ top: 20, right: 16, left: 16, bottom: 6 }}
            >
              <defs>
                <linearGradient id="fillBackupTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#bfe70a" stopOpacity={0.24} />
                  <stop offset="95%" stopColor="#bfe70a" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                vertical={false}
                strokeDasharray="3 3"
                className="stroke-border/40"
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={36}
                tickFormatter={(value: string) =>
                  formatDate(value, { day: "2-digit", month: "short" })
                }
                className="text-[11px] font-medium fill-muted-foreground"
              />
              <YAxis
                hide
                domain={[0, (dataMax: number) => Math.max(Math.ceil(dataMax * 1.25), 4)]}
              />
              <ChartTooltip
                cursor={{
                  stroke: "#bfe70a",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                  strokeOpacity: 0.6,
                }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value: string) =>
                      formatDate(value, { day: "2-digit", month: "short", year: "numeric" })
                    }
                    indicator="line"
                  />
                }
              />
              <Area
                dataKey="total"
                type="monotone"
                fill="url(#fillBackupTotal)"
                stroke="#bfe70a"
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: "#bfe70a",
                  stroke: "var(--color-card, #1C1C20)",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
