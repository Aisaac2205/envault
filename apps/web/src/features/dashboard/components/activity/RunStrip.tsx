import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { BackupJob, JobStatus } from "../../types";

export interface RunStripProps {
  backups: BackupJob[];
}

const MAX_RUNS = 15;

const STATUS_DOT: Record<JobStatus, string> = {
  completed: "bg-success",
  failed: "bg-error",
  running: "bg-chart-running",
  pending: "bg-chart-pending",
};

/**
 * Last 15 backup runs as a compact status strip, plus a text summary that
 * matches the visible counts exactly (dashboard-page-shell "Backup Run
 * Strip"). The cells are decorative (aria-hidden); the summary carries the
 * accessible content.
 */
export function RunStrip({ backups }: RunStripProps) {
  const { t } = useTranslation("dashboard");
  const visible = backups.slice(0, MAX_RUNS);
  const completed = visible.filter((job) => job.status === "completed").length;
  const failed = visible.filter((job) => job.status === "failed").length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1" aria-hidden="true">
        {visible.map((job) => (
          <span key={job.id} className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[job.status])} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("runs.summary", { count: visible.length, completed, failed })}
      </p>
    </div>
  );
}
