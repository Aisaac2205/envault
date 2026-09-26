import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/format";
import { formatUtcFullDate, formatDurationCell } from "../../lib/chart-layout";
import type { DailyBackupPoint } from "../../types";

export interface TrendsDataTableProps {
  points: DailyBackupPoint[];
}

/**
 * Visually-hidden accessible fallback for the whole Trends section (Outcome,
 * Duration, Size) — one table, every value reachable without hovering
 * (Accessible Fallback requirement).
 */
export function TrendsDataTable({ points }: TrendsDataTableProps) {
  const { t } = useTranslation("dashboard");

  return (
    <table className="sr-only">
      <caption>{t("analytics.table.caption")}</caption>
      <thead>
        <tr>
          <th scope="col">{t("analytics.table.date")}</th>
          <th scope="col">{t("analytics.outcome.completed")}</th>
          <th scope="col">{t("analytics.outcome.failed")}</th>
          <th scope="col">{t("analytics.duration.p50")}</th>
          <th scope="col">{t("analytics.duration.p95")}</th>
          <th scope="col">{t("analytics.size.label")}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.date}>
            <th scope="row">{formatUtcFullDate(point.date)}</th>
            <td>{point.completed}</td>
            <td>{point.failed}</td>
            <td>{formatDurationCell(point.p50DurationSeconds)}</td>
            <td>{formatDurationCell(point.p95DurationSeconds)}</td>
            <td>{formatNumber(point.totalSizeMb)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
