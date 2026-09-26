import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/format";
import { formatUtcFullDate, formatDurationCell } from "../../lib/chart-layout";
import type { DailyBackupPoint } from "../../types";

export interface DailyTooltipContentProps {
  point: DailyBackupPoint;
}

/**
 * Shared content for pointer-hover tooltips AND the keyboard readout — same
 * markup, same values, so both modes are identical (Tooltip & Keyboard
 * Access requirement). Values lead (Strong), labels follow (dataviz rule).
 */
export function DailyTooltipContent({ point }: DailyTooltipContentProps) {
  const { t } = useTranslation("dashboard");

  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: "completed", label: t("analytics.outcome.completed"), value: String(point.completed) },
    { key: "failed", label: t("analytics.outcome.failed"), value: String(point.failed) },
    { key: "p50", label: t("analytics.duration.p50"), value: formatDurationCell(point.p50DurationSeconds) },
    { key: "p95", label: t("analytics.duration.p95"), value: formatDurationCell(point.p95DurationSeconds) },
    { key: "size", label: t("analytics.size.label"), value: formatNumber(point.totalSizeMb) },
  ];

  return (
    <div className="min-w-40 rounded-md bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="text-xs text-muted-foreground">{formatUtcFullDate(point.date)}</p>
      <dl className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 text-xs">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-mono font-semibold tabular-nums text-text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
