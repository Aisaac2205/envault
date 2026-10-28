import { useMemo, useState } from "react";
import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConnections } from "@/features/connections/hooks/useConnections";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { LineChartLoading } from "@/shared/ui/charts/line-chart-loading";
import { EmptyState } from "@/shared/ui/empty-state";
import { useDailyAnalytics } from "../hooks/useDailyAnalytics";
import { ConnectionFilter } from "./dump-duration/ConnectionFilter";
import { DumpDurationLegend } from "./dump-duration/DumpDurationLegend";
import { DumpDurationPlot } from "./dump-duration/DumpDurationPlot";
import { QuickRangeControl } from "./dump-duration/QuickRangeControl";
import {
  ALL_CONNECTIONS,
  DEFAULT_RANGE_DAYS,
  hasDurationData,
  toConnectionId,
  toDurationRows,
  type QuickRangeDays,
} from "./dump-duration/dump-duration-data";

const NO_HOVER = () => undefined;

/**
 * The loaded card without its data: the real (inert) legend, which needs none,
 * above a loading chart of the same height as the live one, so the card does not
 * jump when the data arrives at any width.
 */
function DurationLoading({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-live="polite" role="status">
      <DumpDurationLegend
        highlightedIndex={null}
        inert
        onHoverChange={NO_HOVER}
        onTogglePinned={NO_HOVER}
        pinnedKey={null}
      />
      <LineChartLoading
        aspectRatio=""
        className="h-[220px] md:h-[280px]"
        label={label}
      />
    </div>
  );
}

/** Per day dump duration (median, 95th percentile, slowest) over 7, 30 or 90 days. */
export function DumpDurationChart() {
  const { t } = useTranslation("dashboard");
  const [connectionValue, setConnectionValue] = useState(ALL_CONNECTIONS);
  // The window asked of the API, and the chart shows all of it.
  const [rangeDays, setRangeDays] = useState<QuickRangeDays>(DEFAULT_RANGE_DAYS);

  const analytics = useDailyAnalytics(rangeDays, toConnectionId(connectionValue));
  const { data: connections = [] } = useConnections();

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
    body = (
      <EmptyState
        className="min-h-[220px] py-6 md:min-h-[280px]"
        description={t("duration.empty.description", { days: rangeDays })}
        icon={<Timer />}
        title={t("duration.empty.title")}
      />
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
              connections={connections}
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
