import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { DataTable } from "@/shared/ui/data-table";
import { ConnectionLabel } from "@/shared/components/ConnectionLabel";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shortId, formatDateTimeShort as formatDate, formatEnvironment } from "@/lib/format";
import type { BackupJob } from "../types";
import type { Column } from "@/shared/ui/data-table";

interface BackupTimelineProps {
  backups: BackupJob[];
  maxItems?: number;
}

export function BackupTimeline({ backups, maxItems = 8 }: BackupTimelineProps) {
  const { t } = useTranslation('dashboard')
  const visible = maxItems > 0 ? backups.slice(0, maxItems) : backups;
  const remaining = maxItems > 0 ? Math.max(0, backups.length - maxItems) : 0;
  const hasBackups = backups.length > 0;

  const columns: Column<BackupJob>[] = [
    {
      header: t('column.connection'),
      accessor: (job) => (
        <div className="flex flex-col gap-1 py-0.5">
          <ConnectionLabel id={job.connectionId} name={job.connectionName} className="font-medium text-xs text-text-primary leading-tight" />
          <span className="text-[10px] text-muted-foreground/70 leading-tight">
            #{shortId(job.id)}
          </span>
        </div>
      ),
    },
    {
      header: t('column.environment'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">
          {formatEnvironment(job.environment)}
        </span>
      ),
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      header: t('column.status'),
      accessor: (job) => <StatusBadge status={job.status} />,
    },
    {
      header: t('column.when'),
      accessor: (job) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {formatDate(job.createdAt)}
        </span>
      ),
      className: "w-24",
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{t('timeline.backups.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
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
