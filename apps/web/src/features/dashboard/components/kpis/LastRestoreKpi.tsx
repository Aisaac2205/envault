import type { ReactNode } from "react";
import {
  ArchiveRestore,
  CircleAlert,
  CircleCheck,
  CircleX,
  FlaskConical,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatEnvironment, formatRelativeTime } from "@/lib/format";
import { cn } from "@/shared/lib/cn";
import type { JobStatus, RestoreJob } from "../../types";
import { KpiCard } from "./KpiCard";

interface StatusLook {
  icon: LucideIcon;
  /** The job-state color. This card reports a status, so it may use the status tokens. */
  color: string;
}

/** One icon per state, so the status never rests on its color alone. */
const STATUS_LOOK: Record<JobStatus, StatusLook> = {
  completed: { icon: CircleCheck, color: "var(--color-success)" },
  failed: { icon: CircleX, color: "var(--color-error)" },
  running: { icon: LoaderCircle, color: "var(--color-info)" },
  pending: { icon: CircleAlert, color: "var(--color-warning)" },
};

interface LastRestoreKpiProps {
  /** The newest restore, or `null` when none has run. */
  restore: RestoreJob | null;
  loading: boolean;
}

/** The most recent restore: its status, when it ran, and whether it was a dry run. */
export function LastRestoreKpi({ restore, loading }: LastRestoreKpiProps) {
  const { t } = useTranslation("dashboard");
  const { t: tCommon } = useTranslation("common");
  const label = t("kpi.lastRestore");

  if (!restore) {
    return (
      <KpiCard
        accent="var(--chart-4)"
        caption={t("kpi.restore.none")}
        icon={<ArchiveRestore />}
        label={label}
        loading={loading}
        value="—"
      />
    );
  }

  const { icon: StatusIcon, color } = STATUS_LOOK[restore.status];
  const isRunning = restore.status === "running";

  return (
    <KpiCard
      accent={color}
      caption={t("kpi.restore.target", { environment: formatEnvironment(restore.targetEnvironment) })}
      icon={<ArchiveRestore />}
      label={label}
      loading={loading}
      value={
        <span className="inline-flex items-center gap-2">
          <StatusIcon
            aria-hidden="true"
            className={cn("size-6 shrink-0", isRunning && "animate-spin motion-reduce:animate-none")}
            style={{ color }}
          />
          <span>{tCommon(`status.${restore.status}`)}</span>
        </span>
      }
      visual={
        <RestoreDetail>
          <time
            className="text-sm font-medium text-text-primary"
            dateTime={restore.createdAt}
            title={formatDateTime(restore.createdAt)}
          >
            {formatRelativeTime(restore.createdAt)}
          </time>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-text-primary">
            {restore.isDryRun ? <FlaskConical aria-hidden="true" className="size-3.5" /> : <ArchiveRestore aria-hidden="true" className="size-3.5" />}
            {t(restore.isDryRun ? "kpi.restore.dryRun" : "kpi.restore.real")}
          </span>
        </RestoreDetail>
      }
    />
  );
}

/** The bottom row, in the place a sparkline takes on the other cards. */
function RestoreDetail({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 self-end border-t border-dashed border-border pt-3">
      {children}
    </div>
  );
}
