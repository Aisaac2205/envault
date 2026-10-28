import { useId, useMemo } from "react";
import { HeartPulse, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { useConnectionsHealth } from "../hooks/useConnectionsHealth";
import { HEALTH_RANGE_KEY, useStoredRange } from "../hooks/useStoredRange";
import { HealthCardList } from "./connections-health/HealthCardList";
import { CardEmpty } from "./empty-states/CardEmpty";
import type { DataPresence } from "./empty-states/data-presence";
import { HealthTable } from "./connections-health/HealthTable";
import { sortBySeverity } from "./connections-health/health-data";
import { QuickRangeControl } from "./dump-duration/QuickRangeControl";
import { useDurationLocale } from "./dump-duration/use-duration-locale";

/** The body's height while loading and when empty: four 64px rows and three 8px gaps. */
const BODY_HEIGHT = "min-h-[17.5rem]";

/** A few rows of placeholder, so the card does not jump when the data arrives. */
function HealthLoading({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-live="polite" className="space-y-2" role="status">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton className="h-16 w-full motion-reduce:animate-none" key={row} />
      ))}
    </div>
  );
}

/**
 * One row per production connection, worst first: is its latest backup recent
 * enough for its schedule, what ran last, what runs next, and how reliable and
 * fast it has been over the window.
 */
interface ConnectionsHealthCardProps {
  /** What the dashboard has to show, from the page; without any connection the welcome banner leads instead. */
  presence?: DataPresence;
}

export function ConnectionsHealthCard({ presence = "unknown" }: ConnectionsHealthCardProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const titleId = useId();
  // It opens on the window it was left on, kept apart from the duration chart's.
  const [windowDays, setWindowDays] = useStoredRange(HEALTH_RANGE_KEY);
  const health = useConnectionsHealth(windowDays);

  const rows = useMemo(
    () => sortBySeverity(health.data?.connections ?? [], locale),
    [health.data, locale],
  );

  let body;
  if (health.isLoading) {
    body = <HealthLoading label={t("health.loading")} />;
  } else if (health.isError) {
    body = (
      <Alert className="flex flex-wrap items-center justify-between gap-3" variant="destructive">
        <AlertDescription>
          {t("health.error", {
            message: health.error?.message ?? t("error.generic", { ns: "common" }),
          })}
        </AlertDescription>
        <Button onClick={() => void health.refetch()} size="sm" variant="outline">
          {t("health.retry")}
        </Button>
      </Alert>
    );
  } else if (rows.length === 0 && presence === "no-connections") {
    // No connection at all: the welcome banner above is the one way to add the first.
    body = <CardEmpty className={BODY_HEIGHT} icon={<HeartPulse />} message={t("health.empty.noConnections")} />;
  } else if (rows.length === 0) {
    // Connections, but none in production: only this card can say so, and where to fix it.
    body = (
      <CardEmpty
        action={
          <Link
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5 pointer-coarse:h-11")}
            to="/connections"
          >
            <Plus />
            {t("health.empty.cta")}
          </Link>
        }
        className={BODY_HEIGHT}
        icon={<HeartPulse />}
        message={t("health.empty.noProduction")}
      />
    );
  } else {
    body = (
      <>
        {/* The column headings leave the window out: the range control beside the title shows it. */}
        <HealthTable labelledBy={titleId} rows={rows} />
        <HealthCardList labelledBy={titleId} rows={rows} />
      </>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-x-6 gap-y-3 space-y-0 pb-2">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary" id={titleId}>
            {t("health.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("health.caption")}</p>
        </div>
        {/* The range is the window asked of the API: it sets the rate and the percentiles of every row. */}
        <QuickRangeControl label={t("health.range.label")} onSelect={setWindowDays} value={windowDays} />
      </CardHeader>
      <CardContent className="@container px-4 pb-4 sm:px-6">{body}</CardContent>
    </Card>
  );
}
