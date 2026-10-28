import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { useDailyAnalytics } from "../hooks/useDailyAnalytics";
import type { DailyBackupSeries } from "../types";
import { formatCount } from "./backup-stats";
import { BackupsHeatmapPlot } from "./backups-heatmap/BackupsHeatmapPlot";
import { FailureDaysTable } from "./backups-heatmap/FailureDaysTable";
import { FailureSummary } from "./backups-heatmap/FailureSummary";
import { CardEmpty } from "./empty-states/CardEmpty";
import {
  CALENDAR_DAYS,
  emptyWindow,
  failureDays,
  summarizeFailures,
} from "./backups-heatmap/heatmap-data";
import { useDurationLocale } from "./dump-duration/use-duration-locale";
import { formatDayLabel } from "./kpis/kpi-data";

/** What the calendar says in words: the window and its failures. */
function describe(
  series: DailyBackupSeries,
  summary: ReturnType<typeof summarizeFailures>,
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
): string {
  const range = { from: formatDayLabel(series.from, locale), to: formatDayLabel(series.to, locale) };
  if (summary.activeDays === 0) return t("calendar.chartLabel.empty", range);
  return summary.failed > 0
    ? t("calendar.chartLabel", {
        ...range,
        failed: formatCount(summary.failed, locale),
        failedDays: formatCount(summary.failedDays, locale),
        activeDays: formatCount(summary.activeDays, locale),
      })
    : t("calendar.chartLabel.clean", { ...range, activeDays: formatCount(summary.activeDays, locale) });
}

/**
 * A 90 day calendar of backup failures: one cell per UTC day, the darker (light
 * mode) or brighter (dark mode) red the more backups failed. A day with no
 * backups is hatched, a day with none failed is lime.
 */
export function BackupsHeatmapCard() {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const analytics = useDailyAnalytics(CALENDAR_DAYS);
  const series = analytics.data;

  const summary = useMemo(() => (series ? summarizeFailures(series.days) : null), [series]);
  const failed = useMemo(() => (series ? failureDays(series.days) : []), [series]);
  // The grid the card shows while the data is on its way: the same 90 days, all empty.
  const placeholder = useMemo(() => emptyWindow(new Date().toISOString().slice(0, 10)), []);
  // The API fills every day of the window; an answer without days still gets its grid.
  const days = useMemo(
    () => (series && series.days.length > 0 ? series.days : emptyWindow(series?.to ?? placeholder.at(-1)!.date)),
    [series, placeholder],
  );

  let body;
  if (analytics.isLoading) {
    body = (
      <CalendarLayout aside={<FailureSummary summary={null} />}>
        <BackupsHeatmapPlot days={placeholder} description="" loading />
      </CalendarLayout>
    );
  } else if (analytics.isError) {
    body = (
      <Alert className="flex flex-wrap items-center justify-between gap-3" variant="destructive">
        <AlertDescription>
          {t("calendar.error", {
            message: analytics.error?.message ?? t("error.generic", { ns: "common" }),
          })}
        </AlertDescription>
        <Button onClick={() => void analytics.refetch()} size="sm" variant="outline">
          {t("calendar.retry")}
        </Button>
      </Alert>
    );
  } else if (!series || !summary || summary.activeDays === 0) {
    // No backup in the 90 days: the real grid, every day hatched as without backups, and one line
    // where the figures go, in a box as tall as their placeholders at every width.
    body = (
      <CalendarLayout
        aside={
          <CardEmpty
            className="min-h-[12.25rem] @md:min-h-24 @3xl:min-h-[19.5rem]"
            icon={<CalendarDays />}
            message={t("calendar.empty", { days: CALENDAR_DAYS })}
          />
        }
      >
        <BackupsHeatmapPlot
          days={days}
          description={series ? describe(series, summarizeFailures(days), t, locale) : ""}
          loading={false}
        />
      </CalendarLayout>
    );
  } else {
    body = (
      <CalendarLayout aside={<FailureSummary summary={summary} />}>
        <BackupsHeatmapPlot days={series.days} description={describe(series, summary, t, locale)} loading={false} />
        <FailureDaysTable days={failed} />
      </CalendarLayout>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="space-y-1.5 pb-2">
        <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary">
          {t("calendar.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("calendar.subtitle")}</p>
      </CardHeader>
      <CardContent className="@container px-4 pb-4 sm:px-6">{body}</CardContent>
    </Card>
  );
}

interface CalendarLayoutProps {
  /** The figures beside the calendar, their placeholders, or the line that stands in for them. */
  aside: React.ReactNode;
  children: React.ReactNode;
}

/** The calendar on the left and its figures on the right once the card is wide; stacked before that. */
function CalendarLayout({ aside, children }: CalendarLayoutProps) {
  return (
    <div className="flex flex-col gap-5 @3xl:flex-row @3xl:items-start @3xl:gap-8">
      <div className="min-w-0 space-y-3 @3xl:flex-1">{children}</div>
      <div className="@3xl:w-72 @3xl:shrink-0">{aside}</div>
    </div>
  );
}
