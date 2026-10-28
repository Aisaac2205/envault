import { CircleCheck, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DailyBackupPoint } from "../../types";
import { formatCount, formatRate, successRate } from "../backup-stats";
import { useDurationLocale } from "../dump-duration/use-duration-locale";

interface HeatmapDayTooltipProps {
  /** The hovered day; `undefined` for a day the series does not have. */
  day: DailyBackupPoint | undefined;
}

/**
 * Body of the hover card: both counts and that day's success rate. The glyph and
 * the word name each status, so the color is not the only cue. A day with nothing
 * finished shows an em dash as its rate, not 0% or 100%.
 */
export function HeatmapDayTooltip({ day }: HeatmapDayTooltipProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const completed = day?.completed ?? 0;
  const failed = day?.failed ?? 0;

  const rows = [
    { key: "completed", label: t("calendar.completed"), value: completed, Icon: CircleCheck, tone: "text-success" },
    { key: "failed", label: t("calendar.failed"), value: failed, Icon: CircleX, tone: "text-error" },
  ];

  return (
    <div className="space-y-2 px-3.5 py-3" data-testid="heatmap-day-tooltip">
      {rows.map(({ key, label, value, Icon, tone }) => (
        <div className="flex items-center justify-between gap-6" key={key}>
          <div className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden="true" className={`size-4 shrink-0 ${tone}`} />
            <span className="truncate text-sm text-chart-tooltip-muted">{label}</span>
          </div>
          <span className="text-right text-sm font-medium tabular-nums text-chart-tooltip-foreground">
            {formatCount(value, locale)}
          </span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-6 border-t pt-2">
        <span className="text-sm text-chart-tooltip-muted">{t("calendar.rate")}</span>
        <span className="text-right text-base font-semibold tabular-nums text-chart-tooltip-foreground">
          {formatRate(successRate(completed, failed), locale)}
        </span>
      </div>
    </div>
  );
}
