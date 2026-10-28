import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { TooltipHeader } from "@/shared/ui/charts/tooltip";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { formatCount, formatRate, successRate } from "./backups-per-day-data";
import { STATUS_SERIES } from "./backup-status-series";
import { StatusMarker } from "./StatusMarker";

interface BackupsPerDayTooltipProps {
  /** The hovered chart row (`date`, `completed`, `failed`). */
  point: Record<string, unknown>;
}

/**
 * Hover card for the backups chart: the day, both counts and that day's success
 * rate. The value is the strong element; the word beside the status marker names
 * it. A day with nothing finished shows an em dash as its rate, not 0% or 100%.
 */
export function BackupsPerDayTooltip({ point }: BackupsPerDayTooltipProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const date = point.date instanceof Date ? point.date : null;
  const count = (key: string) => {
    const value = point[key];
    return typeof value === "number" ? value : 0;
  };
  const rate = successRate(count("completed"), count("failed"));

  return (
    <div data-testid="backups-per-day-tooltip">
      {date ? (
        <TooltipHeader>
          {formatDate(date, {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </TooltipHeader>
      ) : null}
      <div className="space-y-2 px-3.5 py-3">
        {STATUS_SERIES.map((series) => (
          <div className="flex items-center justify-between gap-6" key={series.key}>
            <div className="flex min-w-0 items-center gap-2">
              <StatusMarker className="size-4 rounded-[4px] [&>svg]:size-3" series={series} />
              <span className="truncate text-sm text-chart-tooltip-muted">
                {t(series.labelKey)}
              </span>
            </div>
            <span className="text-right text-sm font-medium tabular-nums text-chart-tooltip-foreground">
              {formatCount(count(series.key), locale)}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-6 border-t pt-2">
          <span className="text-sm text-chart-tooltip-muted">{t("backups.rate")}</span>
          <span className="text-right text-base font-semibold tabular-nums text-chart-tooltip-foreground">
            {formatRate(rate, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}
