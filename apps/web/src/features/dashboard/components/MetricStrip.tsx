import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { MicroHistogram } from "./MicroHistogram";
import type { DashboardStats, ConnectionEntity, DailyBackupCount } from "../types";

export interface MetricStripProps {
  stats: DashboardStats | null;
  connections: ConnectionEntity[];
  dailyCounts: DailyBackupCount[];
}

interface MetricCellProps {
  label: string;
  value: string | number;
  aside?: ReactNode;
  tone?: "error";
}

function MetricCell({ label, value, aside, tone }: MetricCellProps) {
  return (
    <div className="flex flex-col justify-between gap-2 bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p
          className={cn(
            "font-mono text-xl font-semibold tracking-tight tabular-nums",
            tone === "error" && "text-error",
          )}
        >
          {value}
        </p>
        {aside}
      </div>
    </div>
  );
}

/**
 * Single-surface metric strip replacing the four-card KPI grid
 * (dashboard-page-shell "Metric Strip"): one `bg-hairline` grid, cells
 * `bg-card` — the hairline shows through the gaps as dividers.
 */
export function MetricStrip({ stats, connections, dailyCounts }: MetricStripProps) {
  const { t } = useTranslation("dashboard");
  const active = connections.filter((c) => c.isActive).length;

  const last7 = dailyCounts.slice(-7);
  const sevenDaySeries = last7.map((d) => d.scheduled + d.manual);
  const sevenDayTotal = sevenDaySeries.reduce((a, b) => a + b, 0);
  const failed = stats?.failed7d ?? 0;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-hairline sm:grid-cols-4">
      <MetricCell
        label={t("kpi.successRate")}
        value={stats ? `${stats.successRate30d}%` : "—"}
      />
      <MetricCell
        label={t("kpi.backups7d")}
        value={sevenDayTotal}
        aside={
          sevenDaySeries.length >= 2 ? (
            <MicroHistogram
              data={sevenDaySeries}
              ariaLabel={t("kpi.histAria", { series: sevenDaySeries.join(", ") })}
            />
          ) : undefined
        }
      />
      <MetricCell
        label={t("kpi.failed7d")}
        value={failed}
        tone={failed > 0 ? "error" : undefined}
      />
      <MetricCell
        label={t("kpi.activeConnections")}
        value={`${active}/${connections.length}`}
      />
    </div>
  );
}
