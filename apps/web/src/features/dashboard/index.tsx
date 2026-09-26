import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ShieldAlert, Database, Plus } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { dashboardApi } from "./api/dashboard-api";
import { deriveHeadline } from "./lib/derive-headline";
import {
  useDashboard,
  useConnectionStats,
  useStorageStats,
  useStorageByConnection,
  useRestoreStatus,
} from "./hooks";
import { DashboardHeader } from "./components/DashboardHeader";
import { MetricStrip } from "./components/MetricStrip";
import { Section } from "./components/Section";
import { BackupActivity } from "./components/activity/BackupActivity";
import { RestoreActivity } from "./components/activity/RestoreActivity";
import { NextRuns } from "./components/activity/NextRuns";
import { TrendsSection } from "./components/analytics/TrendsSection";
import { StorageSection } from "./components/analytics/StorageSection";
import { RestoreMeter } from "./components/analytics/RestoreMeter";

/**
 * Restricted-access notice for non-admin sessions (dashboard-page-shell
 * "Restricted Access for Non-Admins"). This is the intended experience, not
 * an error — every endpoint this page needs is `@Roles('admin')` already.
 */
function RestrictedAccessNotice() {
  const { t } = useTranslation("dashboard");
  return (
    <div className="flex w-full flex-col items-center gap-3 p-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground">
        <ShieldAlert className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-text-primary">{t("restricted.title")}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t("restricted.description")}</p>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation("dashboard");
  const { user, isInitializing } = useAuth();
  const isAdmin = user?.role === "admin";

  const dashboard = useDashboard();
  const { data: connections = [], isLoading: connectionsLoading, dataUpdatedAt: connectionsUpdatedAt } = useConnectionStats();
  const { data: dumps = [], dataUpdatedAt: storageUpdatedAt } = useStorageStats();

  const {
    data: cronjobs = [],
    isLoading: cronjobsLoading,
    isError: cronjobsError,
    dataUpdatedAt: cronjobsUpdatedAt,
    refetch: refetchCronjobs,
  } = useQuery({
    queryKey: ["dashboard", "cronjobs"],
    queryFn: async () => {
      const response = await dashboardApi.getCronjobs();
      return Array.isArray(response) ? response : [];
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const { data: stats = null, dataUpdatedAt: statsUpdatedAt } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: dashboardApi.getStats,
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const { data: dailyCounts = [], dataUpdatedAt: dailyCountsUpdatedAt } = useQuery({
    queryKey: ["dashboard", "daily-counts"],
    queryFn: dashboardApi.getDailyCounts,
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const {
    data: storageRows = [],
    isLoading: storageRowsLoading,
    isError: storageRowsError,
    refetch: refetchStorageRows,
  } = useStorageByConnection();

  const {
    data: restoreCounts,
    isLoading: restoreCountsLoading,
    isError: restoreCountsError,
    refetch: refetchRestoreCounts,
  } = useRestoreStatus();

  const headline = useMemo(() => deriveHeadline(dashboard.recentBackups, cronjobs), [dashboard.recentBackups, cronjobs]);
  const updatedAt = useMemo(() => {
    const timestamps = [
      dashboard.dataUpdatedAt,
      connectionsUpdatedAt,
      storageUpdatedAt,
      cronjobsUpdatedAt,
      statsUpdatedAt,
      dailyCountsUpdatedAt,
    ].filter((timestamp): timestamp is number => Boolean(timestamp));
    return timestamps.length > 0 ? Math.max(...timestamps) : null;
  }, [dashboard.dataUpdatedAt, connectionsUpdatedAt, storageUpdatedAt, cronjobsUpdatedAt, statsUpdatedAt, dailyCountsUpdatedAt]);

  const backupsSectionStatus = dashboard.backups.isError
    ? "error"
    : dashboard.backups.isLoading
      ? "loading"
      : dashboard.recentBackups.length === 0
        ? "empty"
        : "ready";

  const nextRunsSectionStatus = cronjobsError
    ? "error"
    : cronjobsLoading
      ? "loading"
      : cronjobs.length === 0
        ? "empty"
        : "ready";

  const restoresLoading = restoreCountsLoading || dashboard.restores.isLoading;
  const restoresError = restoreCountsError || dashboard.restores.isError;
  const restoresEmpty = (restoreCounts?.total ?? 0) === 0 && dashboard.recentRestores.length === 0;
  const restoresSectionStatus = restoresError ? "error" : restoresLoading ? "loading" : restoresEmpty ? "empty" : "ready";

  const storageSectionStatus = storageRowsError
    ? "error"
    : storageRowsLoading
      ? "loading"
      : storageRows.length === 0
        ? "empty"
        : "ready";

  if (isInitializing) {
    return <div className="w-full p-4 sm:p-6" aria-hidden="true" />;
  }

  if (!isAdmin) {
    return (
      <div className="w-full p-4 sm:p-6">
        <RestrictedAccessNotice />
      </div>
    );
  }

  return (
    <div className="@container/page flex w-full flex-col gap-5 p-4 sm:gap-8 sm:p-6">
      <DashboardHeader headline={headline} updatedAt={updatedAt} />

      {connections.length === 0 && !connectionsLoading && (
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-muted/20 p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground shadow-2xs ring-1 ring-border/20">
                <Database className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-text-primary">{t("onboarding.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-xl leading-relaxed text-balance">
                  {t("onboarding.description")}
                </p>
              </div>
            </div>
            <Link to="/connections" className={cn(buttonVariants({ size: "sm" }), "shrink-0 gap-1.5 self-start sm:self-center")}>
              <Plus className="size-4" />
              {t("onboarding.cta")}
            </Link>
          </div>
        </div>
      )}

      <MetricStrip stats={stats} connections={connections} dailyCounts={dailyCounts} />

      <div className="grid grid-cols-1 gap-5 sm:gap-8 @5xl/page:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="flex flex-col gap-5 sm:gap-8">
          <TrendsSection />

          <StorageSection
            rows={storageRows}
            status={storageSectionStatus}
            onRetry={refetchStorageRows}
            liveTotalBytes={dumps.reduce((sum, d) => sum + d.size, 0)}
            liveObjectCount={dumps.length}
          />
        </div>

        <div className="flex flex-col gap-5 sm:gap-8">
          <Section
            id="next-runs"
            title={t("upcoming.title")}
            action={
              <Link to="/cronjobs" className="text-xs font-medium text-muted-foreground hover:text-text-primary">
                {t("action.manage")}
              </Link>
            }
            status={nextRunsSectionStatus}
            skeleton={<div className="h-24 w-full animate-pulse rounded-md bg-hairline" aria-hidden="true" />}
            empty={<p className="text-sm text-muted-foreground">{t("upcoming.empty")}</p>}
            onRetry={refetchCronjobs}
          >
            <NextRuns cronjobs={cronjobs} />
          </Section>

          <Section
            id="recent-backups"
            title={t("timeline.backups.title")}
            action={
              <Link to="/dumps" className="text-xs font-medium text-muted-foreground hover:text-text-primary">
                {t("action.viewAll")}
              </Link>
            }
            status={backupsSectionStatus}
            skeleton={<div className="h-32 w-full animate-pulse rounded-md bg-hairline" aria-hidden="true" />}
            empty={<p className="text-sm text-muted-foreground">{t("timeline.backups.empty.title")}</p>}
            onRetry={dashboard.backups.refetch}
          >
            <BackupActivity backups={dashboard.recentBackups} />
          </Section>

          <Section
            id="restores"
            title={t("timeline.restores.title")}
            meta={<span>{t("section.allTime")}</span>}
            action={
              <Link to="/restore" className="text-xs font-medium text-muted-foreground hover:text-text-primary">
                {t("action.viewAll")}
              </Link>
            }
            status={restoresSectionStatus}
            skeleton={<div className="h-32 w-full animate-pulse rounded-md bg-hairline" aria-hidden="true" />}
            empty={<p className="text-sm text-muted-foreground">{t("timeline.restores.empty.title")}</p>}
            onRetry={() => {
              void refetchRestoreCounts();
              void dashboard.restores.refetch();
            }}
          >
            <div className="flex flex-col gap-4">
              {restoreCounts && <RestoreMeter counts={restoreCounts} />}
              {dashboard.recentRestores.length > 0 && <RestoreActivity restores={dashboard.recentRestores} />}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
