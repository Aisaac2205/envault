import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import type { DailyBackupPoint } from "../../types";
import { formatCount } from "../backup-stats";
import { parseDay } from "../dump-duration/dump-duration-data";
import { useDurationLocale } from "../dump-duration/use-duration-locale";

interface FailureDaysTableProps {
  /** The days with failures, newest first. */
  days: DailyBackupPoint[];
}

/**
 * The failures of the calendar as a table, behind a native disclosure: the cells
 * cannot take the keyboard, and this gives it (and screen readers) the same days
 * and counts the tooltip shows.
 */
export function FailureDaysTable({ days }: FailureDaysTableProps) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();

  if (days.length === 0) return null;

  return (
    <details className="rounded-lg border border-border/70">
      <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-xs font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary pointer-coarse:min-h-11 pointer-coarse:py-3">
        {t("calendar.days.show", { count: days.length })}
      </summary>
      <div className="max-h-56 overflow-auto border-t border-border/70">
        <table aria-label={t("calendar.days.table")} className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="text-left text-text-secondary">
              <th className="px-3 py-2 font-medium" scope="col">{t("calendar.days.date")}</th>
              <th className="px-3 py-2 text-right font-medium" scope="col">{t("calendar.failed")}</th>
              <th className="px-3 py-2 text-right font-medium" scope="col">{t("calendar.completed")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr className="border-t border-border/50" key={day.date}>
                <th className="px-3 py-1.5 text-left font-normal text-text-primary" scope="row">
                  <time dateTime={day.date}>
                    {formatDate(parseDay(day.date), {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                </th>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums text-text-primary">
                  {formatCount(day.failed, locale)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">
                  {formatCount(day.completed, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
