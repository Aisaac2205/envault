import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { TooltipHeader } from "@/shared/ui/charts/tooltip";
import { DURATION_SERIES } from "./duration-series";
import { formatDuration } from "./format-duration";
import { LineSwatch } from "./LineSwatch";
import { useDurationLocale } from "./use-duration-locale";

interface DumpDurationTooltipProps {
  /** The hovered chart row (`date`, `p50`, `p95`, `max`). */
  point: Record<string, unknown>;
}

/**
 * Hover card for the duration chart: the day and the three values. The text
 * wears text tokens; the line sample beside it carries the series identity.
 * A day without a completed backup shows an em dash, not 0.
 */
export function DumpDurationTooltip({ point }: DumpDurationTooltipProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const date = point.date instanceof Date ? point.date : null;

  return (
    <div>
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
        {DURATION_SERIES.map((series) => {
          const value = point[series.key];
          return (
            <div
              className="flex items-center justify-between gap-6"
              key={series.key}
            >
              <div className="flex min-w-0 items-center gap-2">
                <LineSwatch series={series} />
                <span className="truncate text-sm text-chart-tooltip-muted">
                  {t(series.labelKey)}
                </span>
              </div>
              <span className="text-right text-sm font-medium tabular-nums text-chart-tooltip-foreground">
                {formatDuration(typeof value === "number" ? value : null, locale)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
