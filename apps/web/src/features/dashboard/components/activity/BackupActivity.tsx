import { useTranslation } from "react-i18next";
import { formatDateTimeShort, formatEnvironment, formatBytes, shortId } from "@/lib/format";
import { StatusBadge } from "@/shared/ui/status-badge";
import { cn } from "@/shared/lib/cn";
import { RunStrip } from "./RunStrip";
import { ActivityList } from "./ActivityList";
import type { BackupJob } from "../../types";

export interface BackupActivityProps {
  backups: BackupJob[];
  maxItems?: number;
}

const GRID_COLS = "@xl/activity:grid-cols-[minmax(0,1fr)_auto_auto_auto]";

function BackupActivityRow({ job }: { job: BackupJob }) {
  const showError = job.status === "failed" && !!job.errorMessage;
  const sizeLabel = job.fileSizeMb !== null ? formatBytes(job.fileSizeMb * 1024 * 1024) : "—";

  return (
    <li
      className={cn(
        "flex flex-col gap-1 py-2.5 text-sm @xl/activity:grid @xl/activity:items-center @xl/activity:gap-3",
        GRID_COLS,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-text-primary" title={job.connectionName}>
          {job.connectionName}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground @xl/activity:hidden">
          {formatDateTimeShort(job.createdAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <StatusBadge status={job.status} />
        <span>{formatEnvironment(job.environment)}</span>
        <span>#{shortId(job.id)}</span>
      </div>
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground @xl/activity:inline">
        {formatDateTimeShort(job.createdAt)}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground @xl/activity:text-right">
        {sizeLabel}
      </span>
      {showError && (
        <p className="col-span-full truncate text-xs text-error" title={job.errorMessage ?? undefined}>
          {job.errorMessage}
        </p>
      )}
    </li>
  );
}

/**
 * Recent backup activity: a run strip over the full set, then a detailed row
 * per visible backup (dashboard-page-shell "Activity Row Detail"). Assumes a
 * non-empty `backups` array — the Section wrapping this owns the empty
 * state (design: "no EmptyState tiles on this page").
 */
export function BackupActivity({ backups, maxItems = 8 }: BackupActivityProps) {
  const { t } = useTranslation("dashboard");
  const visible = backups.slice(0, maxItems);

  return (
    <div className="flex flex-col gap-3">
      <RunStrip backups={backups} />
      <ActivityList
        gridColsClassName={GRID_COLS}
        columns={[
          { key: "connection", header: t("column.connection") },
          { key: "status", header: t("column.status") },
          { key: "when", header: t("column.when") },
          { key: "size", header: t("column.size") },
        ]}
      >
        {visible.map((job) => (
          <BackupActivityRow key={job.id} job={job} />
        ))}
      </ActivityList>
    </div>
  );
}
