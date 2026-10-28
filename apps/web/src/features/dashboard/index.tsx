import { useDashboard, useConnectionStats, useDailyAnalytics, useRecentFailures } from "./hooks";
import { useTranslation } from "react-i18next";
import { DashboardHeader } from "./components/DashboardHeader";
import { KpiGrid } from "./components/KpiGrid";
import { BackupsHeatmapCard } from "./components/BackupsHeatmapCard";
import { ConnectionsHealthCard } from "./components/ConnectionsHealthCard";
import { DumpDurationChart } from "./components/DumpDurationChart";
import { CALENDAR_DAYS } from "./components/backups-heatmap/heatmap-data";
import { dataPresence } from "./components/empty-states/data-presence";
import { RecentFailuresCard } from "./components/RecentFailuresCard";
import { StorageByConnectionChart } from "./components/StorageByConnectionChart";
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
    recentRestores,
    isLoading: dashboardLoading,
    errors: dashboardErrors,
  } = useDashboard();
  const { data: connections = [], isLoading: connectionsLoading } = useConnectionStats();
  // The card shows the failures; the page reads the same query (one request) so a new failure is announced.
  const { data: recentFailures = [] } = useRecentFailures();

  // The 90 days of the backup calendar (the same query, one request): with the connections they say
  // whether anything has run yet, which every card's empty state follows.
  const quarter = useDailyAnalytics(CALENDAR_DAYS);
  const presence = dataPresence(connectionsLoading ? undefined : connections.length, quarter.data?.days);

  const refreshCycle = recentFailures.length + recentRestores.length + connections.length;

  // The charts and the health card load and show their own states; the overlay covers the lists this page reads itself.
  const rawLoading = dashboardLoading || connectionsLoading;
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

          <DashboardHeader lastUpdated={new Date()} />

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

          <KpiGrid restores={recentRestores} restoresLoading={dashboardLoading} />

          <DumpDurationChart presence={presence} />

          <BackupsHeatmapCard />

          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-stretch">
            <RecentFailuresCard presence={presence} />
            <StorageByConnectionChart />
          </div>

          <ConnectionsHealthCard presence={presence} />
        </div>
      )}

      <GlobalLoadingOverlay open={isLoading} label={t('header.loading', { defaultValue: 'Cargando dashboard...' })} />
    </>
  );
}
