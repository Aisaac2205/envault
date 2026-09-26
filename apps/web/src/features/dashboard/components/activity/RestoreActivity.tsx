import { useTranslation } from "react-i18next";
import { formatDateTimeShort, formatEnvironment, shortId } from "@/lib/format";
import { StatusBadge } from "@/shared/ui/status-badge";
import { cn } from "@/shared/lib/cn";
import { ActivityList } from "./ActivityList";
import type { RestoreJob } from "../../types";

export interface RestoreActivityProps {
  restores: RestoreJob[];
  maxItems?: number;
}

const GRID_COLS = "@xl/activity:grid-cols-[auto_minmax(0,1fr)_auto_auto]";

function RestoreActivityRow({ job }: { job: RestoreJob }) {
  const { t } = useTranslation("dashboard");

  return (
    <li
      className={cn(
        "flex flex-col gap-1 py-2.5 text-sm @xl/activity:grid @xl/activity:items-center @xl/activity:gap-3",
        GRID_COLS,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs font-medium text-text-primary">#{shortId(job.id)}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground @xl/activity:hidden">
          {formatDateTimeShort(job.createdAt)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {formatEnvironment(job.targetEnvironment)} · {t(job.isDryRun ? "restore.dryRun" : "restore.full")}
      </span>
      <StatusBadge status={job.status} />
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground @xl/activity:inline @xl/activity:text-right">
        {formatDateTimeShort(job.createdAt)}
      </span>
    </li>
  );
}

/**
 * Recent restore activity list (dashboard-page-shell). Assumes a non-empty
 * `restores` array — the Section wrapping this owns the empty state.
 */
export function RestoreActivity({ restores, maxItems = 8 }: RestoreActivityProps) {
  const { t } = useTranslation("dashboard");
  const visible = restores.slice(0, maxItems);

  return (
    <ActivityList
      gridColsClassName={GRID_COLS}
      columns={[
        { key: "id", header: t("column.id") },
        { key: "environment", header: t("column.environment") },
        { key: "status", header: t("column.status") },
        { key: "when", header: t("column.when") },
      ]}
    >
      {visible.map((job) => (
        <RestoreActivityRow key={job.id} job={job} />
      ))}
    </ActivityList>
  );
}
