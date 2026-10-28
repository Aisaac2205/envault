import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { KpiCard } from "./KpiCard";
import { KpiSparkline } from "./KpiSparkline";
import { formatDayLabel, hasSeriesData, type DayValue } from "./kpi-data";

/** Where a piece of data is: still loading, failed, or here. */
export type DataStatus = "loading" | "error" | "ready";

interface SeriesKpiProps {
  label: string;
  icon: ReactNode;
  accent: string;
  kind: "area" | "bar";
  /** The headline figure, already formatted. */
  value: string;
  /** The line under it until the pointer is over the plot. */
  caption: string;
  /** Status of the headline figure. */
  valueStatus: DataStatus;
  /** The daily series behind the sparkline; `null` while it has none. */
  series: DayValue[] | null;
  seriesStatus: DataStatus;
  /** Writes one day's value for the caption while the pointer is over it: `96%`, `12 backups`. */
  formatPoint: (value: number) => string;
  onRetry: () => void;
}

/**
 * A KPI whose figure sits on top of a daily trend. Pointing at the plot swaps the
 * caption for that day's value, so the sparkline can be read, not only looked at.
 */
export function SeriesKpi({
  label,
  icon,
  accent,
  kind,
  value,
  caption,
  valueStatus,
  series,
  seriesStatus,
  formatPoint,
  onRetry,
}: SeriesKpiProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const [hovered, setHovered] = useState<number | null>(null);

  const point = hovered !== null && series ? series[hovered] : undefined;
  const shownCaption = point
    ? `${formatDayLabel(point.date, locale)} · ${
        point.value === null ? t("kpi.hover.empty") : formatPoint(point.value)
      }`
    : caption;

  let visual: ReactNode = null;
  if (seriesStatus === "loading") {
    visual = <div aria-hidden="true" className="h-11 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />;
  } else if (seriesStatus === "ready" && series && hasSeriesData(series)) {
    visual = <KpiSparkline color={accent} kind={kind} onHoverChange={setHovered} series={series} />;
  } else {
    // Nothing to draw: a dashed baseline keeps the card's shape instead of a hole.
    visual = <div aria-hidden="true" className="h-px w-full self-center border-t border-dashed border-border" />;
  }

  if (valueStatus === "error") {
    return (
      <KpiCard
        accent={accent}
        caption={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t("kpi.error")}</span>
            <Button className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3" onClick={onRetry} size="sm" variant="outline">
              {t("kpi.retry")}
            </Button>
          </span>
        }
        icon={icon}
        label={label}
        value="—"
        visual={visual}
      />
    );
  }

  return (
    <KpiCard
      accent={accent}
      caption={shownCaption}
      icon={icon}
      label={label}
      loading={valueStatus === "loading"}
      value={value}
      visual={visual}
    />
  );
}
