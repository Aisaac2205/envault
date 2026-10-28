import { useMemo } from "react";
import { CalendarCheck, Gauge, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { useConnectionsHealth } from "../hooks/useConnectionsHealth";
import { useDailyAnalytics } from "../hooks/useDailyAnalytics";
import type { RestoreJob } from "../types";
import { formatCount, formatRate } from "./backup-stats";
import { formatDuration } from "./dump-duration/format-duration";
import { useDurationLocale } from "./dump-duration/use-duration-locale";
import { ComparisonKpi } from "./kpis/ComparisonKpi";
import type { KpiPeriod } from "./kpis/KpiCard";
import { KpiDelta, type Comparison } from "./kpis/KpiDelta";
import { LastRestoreKpi } from "./kpis/LastRestoreKpi";
import { SeriesKpi, type DataStatus } from "./kpis/SeriesKpi";
import {
  BASELINE_WINDOW_DAYS,
  KPI_WINDOW_DAYS,
  RECENT_BACKUP_DAYS,
  countChange,
  lastCalendarDays,
  pickLastRestore,
  rateChange,
  relativeChange,
  sumValues,
  type Change,
} from "./kpis/kpi-data";
import { formatCountChange, formatPercentChange, formatPointsChange } from "./kpis/kpi-format";

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

/** A comparison that waits for the reference while it loads, and says so when there is none. */
function comparisonOf(
  referenceStatus: DataStatus,
  change: Change | null,
  describe: (change: Change) => { text: string; reference: string },
): Comparison {
  if (referenceStatus === "loading") return { status: "loading" };
  if (!change) return { status: "none" };
  return { status: "ready", change, ...describe(change) };
}

/**
 * Four KPIs, each drawn once on the page. The success rate and the 95th
 * percentile come from the connections health answer (the whole window, exact
 * percentiles) and are compared with the 90 day answer, because the charts
 * below already draw their daily series. The 7 day backup count keeps its bars:
 * the calendar shows failures, not volume.
 */
export function KpiGrid({ restores, restoresLoading }: KpiGridProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const health = useConnectionsHealth(KPI_WINDOW_DAYS);
  const baseline = useConnectionsHealth(BASELINE_WINDOW_DAYS);
  const daily = useDailyAnalytics(KPI_WINDOW_DAYS);

  const healthStatus = statusOf(health);
  const baselineStatus = statusOf(baseline);
  const dailyStatus = statusOf(daily);
  const overall = health.data?.overall;
  const reference = baseline.data?.overall;

  const weekSeries = useMemo(
    () =>
      daily.data
        ? lastCalendarDays(daily.data.days, RECENT_BACKUP_DAYS, daily.data.to)
        : null,
    [daily.data],
  );
  // The 7 calendar days before those: the first half of a window twice as long.
  const previousWeekTotal = useMemo(
    () =>
      daily.data
        ? sumValues(lastCalendarDays(daily.data.days, 2 * RECENT_BACKUP_DAYS, daily.data.to).slice(0, RECENT_BACKUP_DAYS))
        : 0,
    [daily.data],
  );
  const weekTotal = weekSeries ? sumValues(weekSeries) : 0;

  const finished = overall ? overall.completed + overall.failed : 0;
  const hasBackups = finished > 0;
  const lastRestore = useMemo(() => pickLastRestore(restores), [restores]);

  const successComparison = comparisonOf(
    baselineStatus,
    rateChange(overall?.successRate, reference?.successRate),
    (change) => ({
      text: t("kpi.delta.points", { value: formatPointsChange(change, locale) }),
      reference: t("kpi.delta.vsBaseline", { value: formatRate(reference?.successRate ?? null, locale) }),
    }),
  );
  const p95Comparison = comparisonOf(
    baselineStatus,
    relativeChange(overall?.p95DurationSeconds, reference?.p95DurationSeconds),
    (change) => ({
      text: formatPercentChange(change, locale),
      reference: t("kpi.delta.vsBaseline", { value: formatDuration(reference?.p95DurationSeconds, locale) }),
    }),
  );
  const weekChange = countChange(weekTotal, previousWeekTotal);
  // Each window once, as a chip: the title stays a plain name.
  const periodOf = (days: number): KpiPeriod => ({
    chip: t("kpi.period.chip", { days }),
    label: t("kpi.period.label", { count: days }),
  });
  const monthPeriod = periodOf(KPI_WINDOW_DAYS);

  return (
    // Two by two on a phone (a single column made the four figures a long scroll), one row from lg.
    <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StaggerItem className="h-full">
        <ComparisonKpi
          accent="var(--chart-1)"
          caption={
            hasBackups && overall
              ? t("kpi.successRate.caption", {
                  completed: formatCount(overall.completed, locale),
                  total: formatCount(finished, locale),
                })
              : t("kpi.noBackups")
          }
          comparison={successComparison}
          icon={<ShieldCheck />}
          label={t("kpi.successRate")}
          onRetry={() => void health.refetch()}
          period={monthPeriod}
          value={formatRate(overall?.successRate ?? null, locale)}
          valueStatus={healthStatus}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <SeriesKpi
          accent="var(--chart-3)"
          caption={
            <KpiDelta
              change={weekChange}
              reference={t("kpi.delta.vsPrevious", { value: formatCount(previousWeekTotal, locale) })}
              text={formatCountChange(weekChange, locale)}
            />
          }
          formatPoint={(value) => t("kpi.hover.backups", { count: value })}
          icon={<CalendarCheck />}
          label={t("kpi.backups7d")}
          onRetry={() => void daily.refetch()}
          period={periodOf(RECENT_BACKUP_DAYS)}
          series={weekSeries}
          seriesStatus={dailyStatus}
          value={formatCount(weekTotal, locale)}
          valueStatus={dailyStatus}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <ComparisonKpi
          accent="var(--chart-duration-p95)"
          caption={
            overall?.p50DurationSeconds != null
              ? t("kpi.p95.caption", { p50: formatDuration(overall.p50DurationSeconds, locale) })
              : t("kpi.noBackups")
          }
          comparison={p95Comparison}
          icon={<Gauge />}
          label={t("kpi.p95")}
          onRetry={() => void health.refetch()}
          period={monthPeriod}
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
