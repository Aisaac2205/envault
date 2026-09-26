import { useMemo } from "react";
import { useDashboard, useConnectionStats, useStorageStats } from "./hooks";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { dashboardApi } from "./api/dashboard-api";
import { deriveHeadline } from "./lib/derive-headline";
import { DashboardHeader } from "./components/DashboardHeader";
import { KpiGrid } from "./components/KpiGrid";
import { SystemHealthCard } from "./components/SystemHealthCard";
import { BackupTimeline } from "./components/BackupTimeline";
import { RestoreTimeline } from "./components/RestoreTimeline";
import { BackupAreaChart } from "./components/BackupAreaChart";
import { UpcomingCronjobsCard } from "./components/UpcomingCronjobsCard";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { Link } from "react-router-dom";
import { Database, Plus } from "lucide-react";
import { GlobalLoadingOverlay } from "@/shared/ui/TetrominoLoader";
import { useSmoothLoading } from "@/shared/hooks/useSmoothLoading";

export default function Dashboard() {
  const { t } = useTranslation('dashboard')
  const {
    recentBackups,
    recentRestores,
    isLoading: dashboardLoading,
    errors: dashboardErrors,
    dataUpdatedAt: dashboardDataUpdatedAt,
  } = useDashboard();
  const {
    data: connections = [],
    isLoading: connectionsLoading,
    dataUpdatedAt: connectionsUpdatedAt,
  } = useConnectionStats();
  const { data: dumps = [], isLoading: storageLoading, dataUpdatedAt: storageUpdatedAt } = useStorageStats();
  const {
    data: cronjobs = [],
    isLoading: cronjobsLoading,
    dataUpdatedAt: cronjobsUpdatedAt,
  } = useQuery({
    queryKey: ["dashboard", "cronjobs"],
    queryFn: async () => {
      const response = await dashboardApi.getCronjobs();
      return Array.isArray(response) ? response : [];
    },
    refetchInterval: 30_000,
  });

  const { data: stats = null, isLoading: statsLoading, dataUpdatedAt: statsUpdatedAt } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: dashboardApi.getStats,
    refetchInterval: 30_000,
  });

  const {
    data: dailyCounts = [],
    isLoading: dailyCountsLoading,
    dataUpdatedAt: dailyCountsUpdatedAt,
  } = useQuery({
    queryKey: ["dashboard", "daily-counts"],
    queryFn: dashboardApi.getDailyCounts,
    refetchInterval: 30_000,
  });

  // dashboard-charts-web: minimal coupling patch (S4) — deriveHeadline and the
  // freshness timestamp need real inputs so DashboardHeader's new prop
  // contract keeps the gate green. The full grid/section rewrite is S7's job.
  const headline = useMemo(() => deriveHeadline(recentBackups, cronjobs), [recentBackups, cronjobs]);
  const updatedAt = useMemo(() => {
    const timestamps = [
      dashboardDataUpdatedAt,
      connectionsUpdatedAt,
      storageUpdatedAt,
      cronjobsUpdatedAt,
      statsUpdatedAt,
      dailyCountsUpdatedAt,
    ].filter((timestamp): timestamp is number => Boolean(timestamp));
    return timestamps.length > 0 ? Math.max(...timestamps) : null;
  }, [dashboardDataUpdatedAt, connectionsUpdatedAt, storageUpdatedAt, cronjobsUpdatedAt, statsUpdatedAt, dailyCountsUpdatedAt]);

  const refreshCycle =
    recentBackups.length +
    recentRestores.length +
    connections.length +
    dumps.length +
    cronjobs.length +
    dailyCounts.length;

  const rawLoading =
    dashboardLoading || connectionsLoading || storageLoading || cronjobsLoading || statsLoading || dailyCountsLoading;
  const isLoading = useSmoothLoading(rawLoading);

  return (
    <>
      {dashboardErrors.length > 0 ? (
        <div className="w-full space-y-5 sm:space-y-8 p-4 sm:p-6">
          <Alert variant="destructive">
            <AlertDescription>
              {t('error.load', { message: dashboardErrors[0]?.message ?? t('error.generic', { ns: 'common' }) })}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="w-full space-y-5 sm:space-y-8 p-4 sm:p-6">
          <div
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {t('header.liveUpdate', { cycle: refreshCycle })}
          </div>

          <DashboardHeader headline={headline} updatedAt={updatedAt} />

          {connections.length === 0 && !rawLoading && (
            <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-muted/20 p-5 sm:p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground shadow-2xs ring-1 ring-border/20">
                    <Database className="size-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight text-text-primary">
                      {t('onboarding.title')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground max-w-xl leading-relaxed text-balance">
                      {t('onboarding.description')}
                    </p>
                  </div>
                </div>
                <Link
                  to="/connections"
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "shrink-0 gap-1.5 self-start sm:self-center",
                  )}
                >
                  <Plus className="size-4" />
                  {t('onboarding.cta')}
                </Link>
              </div>
            </div>
          )}

          <KpiGrid stats={stats} connections={connections} dailyCounts={dailyCounts} />

          <BackupAreaChart data={dailyCounts} />

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-stretch">
            <BackupTimeline backups={recentBackups} />
            <RestoreTimeline restores={recentRestores} />
          </div>

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-stretch">
            <SystemHealthCard dumps={dumps} />
            <UpcomingCronjobsCard cronjobs={cronjobs} />
          </div>
        </div>
      )}

      <GlobalLoadingOverlay open={isLoading} label={t('header.loading', { defaultValue: 'Cargando dashboard...' })} />
    </>
  );
}
