import type { BackupJob, CronjobEntity } from "../types";

export type HeadlineTone = "ok" | "failed" | "running" | "none";

export interface DashboardHeadline {
  tone: HeadlineTone;
  connectionName: string | null;
  at: string | null;
  nextRun: { name: string; at: string } | null;
}

function toneForStatus(status: BackupJob["status"]): HeadlineTone {
  if (status === "completed") return "ok";
  if (status === "failed") return "failed";
  // "running" and "pending" both read as "Backup in progress".
  return "running";
}

/** completedAt for a finished run, startedAt once it's picked up, createdAt while still queued. */
function referenceTimestamp(backup: BackupJob): string | null {
  return backup.completedAt ?? backup.startedAt ?? backup.createdAt ?? null;
}

/**
 * Derives one headline sentence from the latest backup and the next active
 * cronjob run (dashboard-page-shell "Derived Status Line" requirement).
 *
 * `/jobs/backups` returns newest-first server-side already
 * (jobs.repository.ts `order: { createdAt: "DESC" }`), but this sorts
 * defensively so the result stays correct even if that contract changes.
 */
export function deriveHeadline(backups: BackupJob[], cronjobs: CronjobEntity[]): DashboardHeadline {
  const latest = [...backups].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];

  const nextCronjob = cronjobs
    .filter((cronjob): cronjob is CronjobEntity & { nextRunAt: string } => cronjob.isActive && cronjob.nextRunAt !== null)
    .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0];

  return {
    tone: latest ? toneForStatus(latest.status) : "none",
    connectionName: latest?.connectionName ?? null,
    at: latest ? referenceTimestamp(latest) : null,
    nextRun: nextCronjob ? { name: nextCronjob.name, at: nextCronjob.nextRunAt } : null,
  };
}
