import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { RestoreStatusCounts } from "../../types";

export interface RestoreMeterProps {
  counts: RestoreStatusCounts;
}

type Segment = "completed" | "failed" | "running" | "pending";

const SEGMENT_ORDER: Segment[] = ["completed", "failed", "running", "pending"];

const SEGMENT_TONE: Record<Segment, string> = {
  completed: "bg-success",
  failed: "bg-error",
  running: "bg-chart-running",
  pending: "bg-chart-pending",
};

/**
 * Restore outcomes as one 100%-stacked meter bar (Restore Status Meter
 * requirement): success/error + a neutral ramp for running/pending. Every
 * segment's count and status text are ALWAYS visible in the legend below —
 * never color-only, and never clipped for a small fraction.
 */
export function RestoreMeter({ counts }: RestoreMeterProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const total = counts.total;

  const ariaLabel = t("restore.meter.ariaLabel", {
    ns: "dashboard",
    completed: counts.completed,
    failed: counts.failed,
    running: counts.running,
    pending: counts.pending,
    total,
  });

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-hairline"
        style={{ gap: total > 0 ? 2 : 0 }}
      >
        {SEGMENT_ORDER.map((segment) => {
          const value = counts[segment];
          if (total <= 0 || value <= 0) return null;
          const widthPercent = (value / total) * 100;
          return (
            <span
              key={segment}
              data-segment={segment}
              className={cn("h-full rounded-full transition-[width] duration-150 motion-reduce:transition-none", SEGMENT_TONE[segment])}
              style={{ width: `${widthPercent}%` }}
            />
          );
        })}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {SEGMENT_ORDER.map((segment) => {
          const value = counts[segment];
          const percent = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <div key={segment} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", SEGMENT_TONE[segment])} />
              <dt className="text-muted-foreground">{t(`status.${segment}`, { ns: "common" })}</dt>
              <dd className="flex items-center gap-1 font-mono font-semibold tabular-nums text-text-primary">
                <span>{value}</span>
                <span aria-hidden="true">·</span>
                <span>{percent}%</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
