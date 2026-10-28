import { useMemo } from "react";
import { CalendarCheck, Gauge, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { useConnectionsHealth } from "../hooks/useConnectionsHealth";
import { useDailyAnalytics } from "../hooks/useDailyAnalytics";
import type { RestoreJob } from "../types";
import { formatCount, formatRate } from "./backups-per-day/backups-per-day-data";
import { formatDuration } from "./dump-duration/format-duration";
import { useDurationLocale } from "./dump-duration/use-duration-locale";
import { LastRestoreKpi } from "./kpis/LastRestoreKpi";
import { SeriesKpi, type DataStatus } from "./kpis/SeriesKpi";
import {
  KPI_WINDOW_DAYS,
  RECENT_BACKUP_DAYS,
  lastCalendarDays,
  pickLastRestore,
  toP95Series,
  toSuccessRateSeries,
} from "./kpis/kpi-data";

interface KpiGridProps {
  /** The restores the dashboard already fetched. */
  restores: RestoreJob[];
  restoresLoading: boolean;
}

/** `ready` as soon as there is data, even if a later refetch failed: stale figures beat a blank card. */
function statusOf(query: { data: unknown; isError: boolean }): DataStatus {
  if (query.data !== undefined) return "ready";
  return query.isError ? "error" : "loading";
}

/**
 * Four KPIs. The success rate and the 95th percentile come from the connections
 * health answer (the whole window, exact percentiles); their sparklines and the
 * 7 day backup count come from the daily series the charts below already load.
 */
export function KpiGrid({ restores, restoresLoading }: KpiGridProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const health = useConnectionsHealth(KPI_WINDOW_DAYS);
  const daily = useDailyAnalytics(KPI_WINDOW_DAYS);

  const healthStatus = statusOf(health);
  const dailyStatus = statusOf(daily);
  const overall = health.data?.overall;

  const successSeries = useMemo(
    () => (daily.data ? toSuccessRateSeries(daily.data.days) : null),
    [daily.data],
  );
  const p95Series = useMemo(
    () => (daily.data ? toP95Series(daily.data.days) : null),
    [daily.data],
  );
  const weekSeries = useMemo(
    () =>
      daily.data
        ? lastCalendarDays(daily.data.days, RECENT_BACKUP_DAYS, daily.data.to)
        : null,
    [daily.data],
  );
  const weekTotal = weekSeries?.reduce((sum, day) => sum + (day.value ?? 0), 0) ?? 0;

  const finished = overall ? overall.completed + overall.failed : 0;
  const hasBackups = finished > 0;
  const lastRestore = useMemo(() => pickLastRestore(restores), [restores]);

  return (
    <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StaggerItem className="h-full">
        <SeriesKpi
          accent="var(--chart-1)"
          caption={
            hasBackups && overall
              ? t("kpi.successRate.caption", {
                  completed: formatCount(overall.completed, locale),
                  total: formatCount(finished, locale),
                })
              : t("kpi.noBackups")
          }
          formatPoint={(value) => formatRate(value, locale)}
          icon={<ShieldCheck />}
          kind="area"
          label={t("kpi.successRate")}
          onRetry={() => void health.refetch()}
          series={successSeries}
          seriesStatus={dailyStatus}
          value={formatRate(overall?.successRate ?? null, locale)}
          valueStatus={healthStatus}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <SeriesKpi
          accent="var(--chart-3)"
          caption={t("kpi.backups7d.caption")}
          formatPoint={(value) => t("kpi.hover.backups", { count: value })}
          icon={<CalendarCheck />}
          kind="bar"
          label={t("kpi.backups7d")}
          onRetry={() => void daily.refetch()}
          series={weekSeries}
          seriesStatus={dailyStatus}
          value={formatCount(weekTotal, locale)}
          valueStatus={dailyStatus}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <SeriesKpi
          accent="var(--chart-duration-p95)"
          caption={
            overall?.p50DurationSeconds != null
              ? t("kpi.p95.caption", { p50: formatDuration(overall.p50DurationSeconds, locale) })
              : t("kpi.noBackups")
          }
          formatPoint={(value) => formatDuration(value, locale)}
          icon={<Gauge />}
          kind="area"
          label={t("kpi.p95")}
          onRetry={() => void health.refetch()}
          series={p95Series}
          seriesStatus={dailyStatus}
          value={formatDuration(overall?.p95DurationSeconds, locale)}
          valueStatus={healthStatus}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <LastRestoreKpi loading={restoresLoading} restore={lastRestore} />
      </StaggerItem>
    </Stagger>
  );
}
