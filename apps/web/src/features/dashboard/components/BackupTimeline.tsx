import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { DataTable } from "@/shared/ui/data-table";
import { ConnectionLabel } from "@/shared/components/ConnectionLabel";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shortId, formatDateTime } from "@/lib/format";
import type { BackupJob } from "../types";
import type { Column } from "@/shared/ui/data-table";
import { compactDateParts } from "./compact-date";
import { useDurationLocale } from "./dump-duration/use-duration-locale";

/** Rows shown before "+N more": the dashboard's recent backups are a glance, not a log. */
const DEFAULT_MAX_ITEMS = 5;

interface BackupTimelineProps {
  backups: BackupJob[];
  maxItems?: number;
}

export function BackupTimeline({ backups, maxItems = DEFAULT_MAX_ITEMS }: BackupTimelineProps) {
  const { t } = useTranslation('dashboard')
  const locale = useDurationLocale();
  const visible = maxItems > 0 ? backups.slice(0, maxItems) : backups;
  const remaining = maxItems > 0 ? Math.max(0, backups.length - maxItems) : 0;
  const hasBackups = backups.length > 0;

  const columns: Column<BackupJob>[] = [
    {
      header: t('column.connection'),
      accessor: (job) => (
        <div className="flex flex-col gap-1 py-0.5">
          {/* The shared label cuts a name to one line, which keeps the table wider than a half width card (and pushes the date out). Here it wraps to two, and the full name is on hover. */}
          <ConnectionLabel
            id={job.connectionId}
            name={job.connectionName}
            className="font-medium text-xs text-text-primary leading-tight [&>span]:line-clamp-2 [&>span]:whitespace-normal [&>span]:[overflow-wrap:anywhere]"
          />
          <span className="text-[10px] text-muted-foreground/70 leading-tight">
            #{shortId(job.id)}
          </span>
        </div>
      ),
    },
    // No environment column: only production connections are backed up, so it
    // would always read the same and cost width the date column needs.
    {
      header: t('column.status'),
      accessor: (job) => <StatusBadge status={job.status} />,
    },
    {
      header: t('column.when'),
      // A compact date, so the column fits a half width card without scrolling; the full one is on hover.
      // On a card narrower than 384px the day and the time stack, which hands the width to the connection name.
      accessor: (job) => {
        const { date, time } = compactDateParts(job.createdAt, locale);
        return (
          <time
            className="text-xs tabular-nums text-muted-foreground"
            dateTime={job.createdAt}
            title={formatDateTime(job.createdAt)}
          >
            <span className="block whitespace-nowrap @sm:inline">{date}</span>
            <span aria-hidden="true" className="hidden @sm:inline">, </span>
            <span className="block whitespace-nowrap @sm:inline">{time}</span>
          </time>
        );
      },
      className: "@sm:w-28",
    },
  ];

  return (
    // min-w-0: a wide table scrolls inside the card (the table wrapper has overflow-x-auto), never the page.
    <Card className="flex h-full min-w-0 flex-col border-border/80 shadow-xs">
      <CardHeader className="pb-2">
        <h2 className="text-base font-semibold leading-none tracking-tight text-text-primary">
          {t('timeline.backups.title')}
        </h2>
      </CardHeader>
      <CardContent className="@container flex min-w-0 flex-1 flex-col justify-between px-4 pb-4 sm:px-6">
        {hasBackups ? (
          <>
            <DataTable columns={columns} data={visible} compact />
            {remaining > 0 && (
              <p className="py-2.5 text-center text-xs text-muted-foreground">
                {t('label.more', { count: remaining, ns: 'common' })}
              </p>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Clock className="h-8 w-8" />}
            title={t('timeline.backups.empty.title')}
            description={t('timeline.backups.empty.description')}
          />
        )}
      </CardContent>
    </Card>
  );
}
