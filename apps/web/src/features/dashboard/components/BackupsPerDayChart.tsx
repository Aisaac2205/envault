import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { useDailyAnalytics } from "../hooks/useDailyAnalytics";
import type { AnalyticsWindow } from "../types";
import {
  DEFAULT_WINDOW,
  hasBackupData,
  toBackupRows,
} from "./backups-per-day/backups-per-day-data";
import { BackupsPerDayPlot } from "./backups-per-day/BackupsPerDayPlot";
import { QuickRangeControl } from "./dump-duration/QuickRangeControl";
import { useDurationLocale } from "./dump-duration/use-duration-locale";

/** Bar heights, in percent, of the placeholder silhouette: one per day of the default window. */
const SKELETON_HEIGHTS = [
  55, 70, 48, 82, 62, 75, 40, 66, 88, 52, 72, 58, 80, 45, 68, 60, 84, 50, 74, 64, 56, 78,
  46, 70, 60, 86, 54, 72, 66, 58,
];

/**
 * A pulsing placeholder with the loaded layout (caption, three legend tiles, a
 * row of bars), so the card does not jump when the data arrives. The stock bklit
 * bar skeleton sweeps a shimmer mask across its bars, and that mask paints
 * nothing in Chromium, which left the card blank.
 */
function BackupsLoading({ label }: { label: string }) {
  const pulse = "motion-reduce:animate-none";
  return (
    <div aria-label={label} aria-live="polite" role="status">
      <div className="mb-3 space-y-1.5">
        <Skeleton className={cn("h-3 w-44", pulse)} />
        <div className="grid grid-cols-1 gap-1.5 sm:flex sm:gap-2">
          {[0, 1, 2].map((tile) => (
            <Skeleton className={cn("h-11 sm:h-16 sm:w-40", pulse)} key={tile} />
          ))}
        </div>
      </div>
      <div className="flex h-[220px] items-end gap-1 pb-8 pl-9 pr-3 md:h-[280px]">
        {SKELETON_HEIGHTS.map((height, index) => (
          <Skeleton
            className={cn("flex-1 rounded-t-md rounded-b-sm", pulse)}
            key={index}
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Per day count of completed and failed backups, stacked, over 7, 30 or 90 days. */
export function BackupsPerDayChart() {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const [windowDays, setWindowDays] = useState<AnalyticsWindow>(DEFAULT_WINDOW);

  const analytics = useDailyAnalytics(windowDays);

  const series = analytics.data;
  const rows = useMemo(
    () => (series ? toBackupRows(series.days, locale) : []),
    [series, locale],
  );
  const hasData = hasBackupData(rows);

  let body;
  if (analytics.isLoading) {
    body = <BackupsLoading label={t("backups.loading")} />;
  } else if (analytics.isError) {
    body = (
      <Alert className="flex flex-wrap items-center justify-between gap-3" variant="destructive">
        <AlertDescription>
          {t("backups.error", {
            message: analytics.error?.message ?? t("error.generic", { ns: "common" }),
          })}
        </AlertDescription>
        <Button onClick={() => void analytics.refetch()} size="sm" variant="outline">
          {t("backups.retry")}
        </Button>
      </Alert>
    );
  } else if (!hasData) {
    body = (
      <EmptyState
        className="min-h-[220px] py-6 md:min-h-[280px]"
        description={t("backups.empty.description", { days: windowDays })}
        icon={<BarChart3 />}
        title={t("backups.empty.title")}
      />
    );
  } else {
    body = <BackupsPerDayPlot rows={rows} />;
  }

  return (
    <Card className="overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-3 space-y-0 pb-2">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary">
            {t("backups.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("backups.subtitle")}</p>
        </div>
        {/* The range is the window asked of the API, so it stays whatever the body shows. */}
        <QuickRangeControl onSelect={setWindowDays} value={windowDays} />
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6">{body}</CardContent>
    </Card>
  );
}
