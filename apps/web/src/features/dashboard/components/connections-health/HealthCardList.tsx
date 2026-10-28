import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { ConnectionHealth } from "../../types";
import { FreshnessBadge } from "./FreshnessBadge";
import { EngineChip, LastBackupCell, NextRunCell, RateCell, ScheduleCell } from "./HealthCells";
import { FRESHNESS_META } from "./freshness-meta";
import { earliestNextRun } from "./health-data";

interface HealthCardListProps {
  rows: ConnectionHealth[];
  windowDays: number;
  /** The id of the card's heading, which names the list. */
  labelledBy: string;
}

/** The narrow layout: each connection is a card, so nothing scrolls sideways. */
export function HealthCardList({ rows, windowDays, labelledBy }: HealthCardListProps) {
  const { t } = useTranslation("dashboard");

  return (
    <ul aria-labelledby={labelledBy} className="grid gap-3 @4xl:hidden">
      {rows.map((row) => (
        <li
          className={cn(
            "min-w-0 rounded-lg border border-border/80 bg-card p-3.5",
            FRESHNESS_META[row.freshness].rowTone,
          )}
          key={row.connectionId}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="min-w-0 truncate text-sm font-semibold text-text-primary" title={row.connectionName}>
                {row.connectionName}
              </h3>
              <EngineChip dbType={row.dbType} />
            </div>
            <FreshnessBadge className="shrink-0" freshness={row.freshness} />
          </div>
          <dl className="mt-3 grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-start gap-x-4 gap-y-2.5">
            <dt className="text-xs text-text-secondary">{t("health.column.lastBackup")}</dt>
            <dd>
              <LastBackupCell backup={row.lastBackup} />
            </dd>
            <dt className="text-xs text-text-secondary">{t("column.nextRun")}</dt>
            <dd>
              <NextRunCell nextRunAt={earliestNextRun(row.schedules)} />
            </dd>
            <dt className="text-xs text-text-secondary">{t("health.column.success", { days: windowDays })}</dt>
            <dd>
              <RateCell connection={row} />
            </dd>
            <dt className="text-xs text-text-secondary">{t("health.column.schedule")}</dt>
            <dd>
              <ScheduleCell schedules={row.schedules} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
