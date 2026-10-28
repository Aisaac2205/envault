import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatCount } from "../backup-stats";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import type { FailureSummary as Summary } from "./heatmap-data";

interface StatProps {
  label: string;
  value: ReactNode;
  hint: string;
  /** A CSS color for the small marker; the same token the calendar uses. */
  marker: string;
}

function Stat({ label, value, hint, marker }: StatProps) {
  return (
    // A row (label and note left, figure right) while the card is narrow, a tile once three fit side by side.
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg border border-border/70 bg-muted/30 px-3.5 py-3 @md:grid-cols-1 @md:items-start @md:p-3.5"
      data-stat=""
    >
      <dt className="col-start-1 row-start-1 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-[3px]"
          style={{ backgroundColor: marker }}
        />
        {label}
      </dt>
      <dd className="col-start-2 row-span-2 row-start-1 text-2xl font-semibold leading-none tracking-tight tabular-nums text-text-primary @md:col-start-1 @md:row-span-1 @md:row-start-2 @md:mt-2">
        {value}
      </dd>
      <dd className="col-start-1 row-start-2 mt-1 text-xs leading-4 text-text-secondary @md:row-start-3 @md:mt-1.5 @md:min-h-4">
        {hint}
      </dd>
    </div>
  );
}

interface FailureSummaryProps {
  /** `null` while the data is on its way. */
  summary: Summary | null;
}

/**
 * Three figures beside the calendar: how many days had failures, how many backups
 * failed, and how long it has been since one did. They also say in words what the
 * colors show, for whoever cannot tell the shades apart.
 */
export function FailureSummary({ summary }: FailureSummaryProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();

  if (!summary) {
    return (
      <div className="grid grid-cols-1 gap-2 @md:grid-cols-3 @3xl:grid-cols-1 @3xl:gap-3">
        {[0, 1, 2].map((tile) => (
          <Skeleton
            className="h-[3.75rem] motion-reduce:animate-none @md:h-24"
            data-testid="heatmap-stat-skeleton"
            key={tile}
          />
        ))}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-2 @md:grid-cols-3 @3xl:grid-cols-1 @3xl:gap-3">
      <Stat
        hint={t("calendar.stat.failedDays.of", { count: summary.activeDays })}
        label={t("calendar.stat.failedDays")}
        marker="var(--chart-scale-04)"
        value={formatCount(summary.failedDays, locale)}
      />
      {/* No success rate under it: the KPI row already compares the rate with the 90 days. */}
      <Stat
        hint=""
        label={t("calendar.stat.failed")}
        marker="var(--color-error)"
        value={formatCount(summary.failed, locale)}
      />
      <Stat
        hint=""
        label={t("calendar.stat.streak")}
        marker="var(--chart-1)"
        value={t("calendar.stat.streak.value", { count: summary.streak })}
      />
    </dl>
  );
}
