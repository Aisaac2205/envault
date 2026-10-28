import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { ConnectionHealth } from "../../types";
import { FreshnessBadge } from "./FreshnessBadge";
import { EngineMark } from "./EngineIcon";
import { LastBackupCell, NextRunCell, RateCell, ScheduleCell } from "./HealthCells";
import { FRESHNESS_META } from "./freshness-meta";
import { earliestNextRun } from "./health-data";

interface HealthTableProps {
  rows: ConnectionHealth[];
  /** The id of the card's heading, which names the table. */
  labelledBy: string;
}

const HEAD = "px-3 py-2 text-left align-bottom text-xs font-medium text-text-secondary";
const CELL = "px-3 py-3 align-middle";

/** The wide layout: one row per connection. It shows once the card is wide enough to hold every column. */
export function HealthTable({ rows, labelledBy }: HealthTableProps) {
  const { t } = useTranslation("dashboard");

  return (
    <div className="hidden @4xl:block">
      <table aria-labelledby={labelledBy} className="w-full table-fixed border-collapse">
        <colgroup>
          {/* The connection column takes what the fixed ones leave: as much as the other five can spare, since a name is the one thing that cannot be shortened. */}
          <col />
          <col className="w-36" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-40" />
          <col className="w-32" />
        </colgroup>
        <thead>
          <tr className="border-b border-border">
            <th className={HEAD} scope="col">{t("column.connection")}</th>
            <th className={HEAD} scope="col">{t("health.column.freshness")}</th>
            <th className={HEAD} scope="col">{t("health.column.lastBackup")}</th>
            <th className={HEAD} scope="col">{t("column.nextRun")}</th>
            <th className={HEAD} scope="col">{t("health.column.success")}</th>
            <th className={HEAD} scope="col">{t("health.column.schedule")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className={cn(
                "border-b border-border/60 transition-colors duration-150 last:border-0 hover:bg-muted/40 motion-reduce:transition-none",
                FRESHNESS_META[row.freshness].rowTone,
              )}
              key={row.connectionId}
            >
              <th className={cn(CELL, "text-left font-normal")} scope="row">
                <div className="flex min-w-0 items-center gap-2">
                  {/* Two lines before it gives up (a name with no spaces breaks anywhere), so a long name is still readable; the full name is on hover. */}
                  <span
                    className="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-text-primary [overflow-wrap:anywhere]"
                    title={row.connectionName}
                  >
                    {row.connectionName}
                  </span>
                  <EngineMark dbType={row.dbType} />
                </div>
              </th>
              <td className={CELL}>
                <FreshnessBadge freshness={row.freshness} />
              </td>
              <td className={CELL}>
                <LastBackupCell backup={row.lastBackup} />
              </td>
              <td className={CELL}>
                <NextRunCell nextRunAt={earliestNextRun(row.schedules)} />
              </td>
              <td className={CELL}>
                <RateCell connection={row} />
              </td>
              <td className={CELL}>
                <ScheduleCell schedules={row.schedules} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
