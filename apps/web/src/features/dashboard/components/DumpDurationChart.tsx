import { useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnections } from "@/features/connections/hooks/useConnections";
import { isProdConnection } from "@/features/connections/types";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { LineChartLoading } from "@/shared/ui/charts/line-chart-loading";
import { useDailyAnalytics } from "../hooks/useDailyAnalytics";
import { DURATION_RANGE_KEY, useStoredRange } from "../hooks/useStoredRange";
import { CardEmpty } from "./empty-states/CardEmpty";
import { type DataPresence, isNothingYet } from "./empty-states/data-presence";
import { ConnectionFilter } from "./dump-duration/ConnectionFilter";
import { DumpDurationLegend } from "./dump-duration/DumpDurationLegend";
import { DumpDurationPlot } from "./dump-duration/DumpDurationPlot";
import { QuickRangeControl } from "./dump-duration/QuickRangeControl";
import {
  ALL_CONNECTIONS,
  hasDurationData,
  QUICK_RANGE_DAYS,
  toConnectionId,
  toDurationRows,
} from "./dump-duration/dump-duration-data";

const NO_HOVER = () => undefined;
/** The widest quick range: what an empty range can widen to. */
const WIDEST_RANGE = QUICK_RANGE_DAYS[QUICK_RANGE_DAYS.length - 1];
/** The plot's height, which the loading chart and the empty message take too. */
const PLOT_HEIGHT = "h-[220px] md:h-[280px]";

/** The real legend, inert: it needs no data, and it keeps the card's height before there is a chart. */
function InertLegend() {
  return (
    <DumpDurationLegend
      highlightedIndex={null}
      inert
      onHoverChange={NO_HOVER}
      onTogglePinned={NO_HOVER}
      pinnedKey={null}
    />
  );
}

/**
 * The loaded card without its data: the inert legend above a loading chart of
 * the same height as the live one, so the card does not jump when the data
 * arrives at any width.
 */
function DurationLoading({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-live="polite" role="status">
      <InertLegend />
      <LineChartLoading aspectRatio="" className={PLOT_HEIGHT} label={label} />
    </div>
  );
}

interface DumpDurationChartProps {
  /** What the dashboard has to show, from the page; it picks what an empty chart says. */
  presence?: DataPresence;
}

/** Per day dump duration (median, 95th percentile, slowest) over 7, 30 or 90 days. */
export function DumpDurationChart({ presence = "unknown" }: DumpDurationChartProps) {
  const { t } = useTranslation("dashboard");
  const [selectedValue, setConnectionValue] = useState(ALL_CONNECTIONS);
  // The window asked of the API, and the chart shows all of it. It opens on the one it was left on.
  const [rangeDays, setRangeDays] = useStoredRange(DURATION_RANGE_KEY);

  const { data: connections = [] } = useConnections();
  // The API backs up production only: a dev or qa connection would always draw an empty chart.
  const prodConnections = useMemo(() => connections.filter(isProdConnection), [connections]);
  // A connection that is no longer offered (moved out of production, or deleted) falls back to all.
  const connectionValue =
    selectedValue === ALL_CONNECTIONS || prodConnections.some((c) => c.id === selectedValue)
      ? selectedValue
      : ALL_CONNECTIONS;

  const analytics = useDailyAnalytics(rangeDays, toConnectionId(connectionValue));

  const series = analytics.data;
  const rows = useMemo(
    () => (series ? toDurationRows(series.days) : []),
    [series],
  );
  const hasData = hasDurationData(rows);

  let body;
  if (analytics.isLoading) {
    body = <DurationLoading label={t("duration.loading")} />;
  } else if (analytics.isError) {
    body = (
      <Alert className="flex flex-wrap items-center justify-between gap-3" variant="destructive">
        <AlertDescription>
          {t("duration.error", {
            message: analytics.error?.message ?? t("error.generic", { ns: "common" }),
          })}
        </AlertDescription>
        <Button onClick={() => void analytics.refetch()} size="sm" variant="outline">
          {t("duration.retry")}
        </Button>
      </Alert>
    );
  } else if (!hasData) {
    // Before the first backup there is no range to blame; after it, the range may be the reason.
    const nothingYet = isNothingYet(presence);
    body = (
      <div>
        <InertLegend />
        <CardEmpty
          action={
            !nothingYet && rangeDays < WIDEST_RANGE ? (
              <Button onClick={() => setRangeDays(WIDEST_RANGE)} size="sm" variant="outline">
                {t("duration.empty.showAll", { days: WIDEST_RANGE })}
              </Button>
            ) : undefined
          }
          className={PLOT_HEIGHT}
          icon={<Timer />}
          message={nothingYet ? t("duration.empty.noBackups") : t("duration.empty.range", { days: rangeDays })}
        />
      </div>
    );
  } else {
    body = <DumpDurationPlot rows={rows} />;
  }

  return (
    <Card className="overflow-hidden border-border/80 shadow-xs">
      <CardHeader className="pb-2">
        <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary">
          {t("duration.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("duration.subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="w-full sm:w-auto">
            <ConnectionFilter
              connections={prodConnections}
              onValueChange={setConnectionValue}
              value={connectionValue}
            />
          </div>
          {/* The range is the window asked of the API, so it stays whatever the body shows. */}
          <QuickRangeControl onSelect={setRangeDays} value={rangeDays} />
        </div>
        {body}
      </CardContent>
    </Card>
  );
}
