import { CircleCheck, CircleX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatRelativeTime, formatUpcomingTime } from "@/lib/format";
import { cn } from "@/shared/lib/cn";
import type { ConnectionHealth, ConnectionLastBackup, ConnectionSchedule } from "../../types";
import { formatRate } from "../backup-stats";
import { formatDuration } from "../dump-duration/format-duration";
import { useDurationLocale } from "../dump-duration/use-duration-locale";
import { describeInterval, engineLabel, tightestSchedule } from "./health-data";

const MISSING = "—";

/** `PG` / `MySQL`: which engine the connection speaks. Not a status, so it stays neutral. */
export function EngineChip({ dbType }: { dbType: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded border border-border bg-muted/60 px-1.5 py-px text-[11px] font-medium leading-4 text-text-secondary">
      {engineLabel(dbType)}
    </span>
  );
}

/** The latest backup: its outcome (icon and label), how long ago it ended and how long it took. */
export function LastBackupCell({ backup }: { backup: ConnectionLastBackup | null }) {
  const { t } = useTranslation("dashboard");
  const { t: tCommon } = useTranslation("common");
  const locale = useDurationLocale();

  if (!backup) {
    return <span className="text-xs text-text-secondary">{t("health.lastBackup.none")}</span>;
  }

  const ended = backup.completedAt ?? backup.createdAt;
  const completed = backup.status === "completed";
  const Icon = completed ? CircleCheck : CircleX;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-primary">
        <Icon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", completed ? "text-success" : "text-error")}
        />
        {tCommon(`status.${backup.status}`)}
      </span>
      <span className="text-xs tabular-nums text-text-secondary">
        <time dateTime={ended} title={formatDateTime(ended)}>
          {formatRelativeTime(ended)}
        </time>
        {backup.durationSeconds !== null && ` · ${formatDuration(backup.durationSeconds, locale)}`}
      </span>
    </div>
  );
}

/** When the soonest schedule runs next: relative, with the exact time on hover. */
export function NextRunCell({ nextRunAt }: { nextRunAt: string | null }) {
  if (!nextRunAt) {
    return <span className="text-xs text-text-secondary">{MISSING}</span>;
  }
  return (
    <time
      className="text-xs tabular-nums text-text-primary"
      dateTime={nextRunAt}
      title={formatDateTime(nextRunAt)}
    >
      {formatUpcomingTime(nextRunAt)}
    </time>
  );
}

/** Success rate over the window, with a bar for the eye, and the median and 95th percentile duration. */
export function RateCell({ connection }: { connection: ConnectionHealth }) {
  const { t } = useTranslation("dashboard");
  const locale = useDurationLocale();
  const { successRate, completed, failed } = connection;
  const counts = t("health.rate.counts", { completed, failed });

  return (
    <div className="flex min-w-0 flex-col gap-1" title={counts}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tabular-nums text-text-primary">
          {formatRate(successRate, locale)}
        </span>
        {successRate !== null && (
          <span aria-hidden="true" className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(0, Math.min(1, successRate)) * 100}%`, background: "var(--chart-1)" }}
            />
          </span>
        )}
        <span className="sr-only">{counts}</span>
      </div>
      {/* Each figure stays whole: when the column is narrow, the line breaks between them. */}
      <span className="flex flex-wrap gap-x-2 text-xs tabular-nums text-text-secondary">
        <span className="whitespace-nowrap">
          {t("health.rate.p50", { value: formatDuration(connection.p50DurationSeconds, locale) })}
        </span>
        {" "}
        <span className="whitespace-nowrap">
          {t("health.rate.p95", { value: formatDuration(connection.p95DurationSeconds, locale) })}
        </span>
      </span>
    </div>
  );
}

/** The expected gap between runs, from the tightest schedule, plus how many more schedules there are. */
export function ScheduleCell({ schedules }: { schedules: ConnectionSchedule[] }) {
  const { t } = useTranslation("dashboard");
  const tightest = tightestSchedule(schedules);

  if (!tightest || tightest.intervalSeconds === null) {
    return <span className="text-xs text-text-secondary">{MISSING}</span>;
  }

  const interval = describeInterval(tightest.intervalSeconds);
  const text =
    interval.kind === "daily"
      ? t("health.interval.daily")
      : interval.kind === "weekly"
        ? t("health.interval.weekly")
        : t(interval.approximate ? "health.interval.everyMax" : "health.interval.every", {
            span: interval.span,
          });
  const extra = schedules.length - 1;

  return (
    <span className="inline-flex items-baseline gap-1.5 text-xs tabular-nums text-text-primary">
      {text}
      {extra > 0 && (
        <span className="text-text-secondary" title={t("health.interval.more", { count: extra })}>
          <span aria-hidden="true">+{extra}</span>
          <span className="sr-only">{t("health.interval.more", { count: extra })}</span>
        </span>
      )}
    </span>
  );
}
