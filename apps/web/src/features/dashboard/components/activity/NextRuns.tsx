import { useTranslation } from "react-i18next";
import { formatUpcomingTime } from "@/lib/format";
import type { CronjobEntity } from "../../types";

export interface NextRunsProps {
  cronjobs: CronjobEntity[];
  maxItems?: number;
}

/**
 * Upcoming scheduled cronjob runs, distinct from past activity
 * (dashboard-page-shell "Next Runs List"). Assumes the caller has already
 * checked for a non-empty list — the wrapping Section owns the empty state.
 */
export function NextRuns({ cronjobs, maxItems = 3 }: NextRunsProps) {
  const { t } = useTranslation("dashboard");
  const active = cronjobs.filter((cronjob) => cronjob.isActive);
  const paused = cronjobs.filter((cronjob) => !cronjob.isActive);

  const sortedActive = [...active].sort((a, b) => {
    if (!a.nextRunAt) return 1;
    if (!b.nextRunAt) return -1;
    return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
  });

  const visible = sortedActive.slice(0, maxItems);
  const remaining = sortedActive.length - visible.length;

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-hairline">
        {visible.map((cronjob) => (
          <li key={cronjob.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-text-primary" title={cronjob.name}>
                {cronjob.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {cronjob.connectionName ?? cronjob.cronExpression}
              </span>
            </div>
            <span className="shrink-0 font-mono text-xs font-medium tabular-nums text-muted-foreground">
              {cronjob.nextRunAt ? formatUpcomingTime(cronjob.nextRunAt) : t("upcoming.noNext")}
            </span>
          </li>
        ))}
      </ul>
      {(remaining > 0 || paused.length > 0) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          {remaining > 0 && <span>{t("upcoming.more", { count: remaining })}</span>}
          {paused.length > 0 && (
            <span>{t(paused.length === 1 ? "upcoming.paused_one" : "upcoming.paused_other", { count: paused.length })}</span>
          )}
        </p>
      )}
    </div>
  );
}
