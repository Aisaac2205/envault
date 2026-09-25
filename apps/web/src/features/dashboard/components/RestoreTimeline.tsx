import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { DataTable } from "@/shared/ui/data-table";
import { StatusBadge } from "@/shared/ui/status-badge";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shortId, formatDateTimeShort as formatDate, formatEnvironment } from "@/lib/format";
import type { RestoreJob } from "../types";
import type { Column } from "@/shared/ui/data-table";

interface RestoreTimelineProps {
  restores: RestoreJob[];
  maxItems?: number;
}

export function RestoreTimeline({ restores, maxItems = 8 }: RestoreTimelineProps) {
  const { t } = useTranslation('dashboard')
  const visible = maxItems > 0 ? restores.slice(0, maxItems) : restores;
  const remaining = maxItems > 0 ? Math.max(0, restores.length - maxItems) : 0;
  const hasRestores = restores.length > 0;

  const columns: Column<RestoreJob>[] = [
    {
      header: t('column.id'),
      accessor: (job) => (
        <div className="flex flex-col gap-1 py-0.5">
          <span className="truncate text-xs font-medium text-text-primary leading-tight">#{shortId(job.id)}</span>
          <span className="text-[10px] text-muted-foreground/70 leading-tight">
            {job.isDryRun ? "dry-run" : "restore"}
          </span>
        </div>
      ),
      className: "w-24",
    },
    {
      header: t('column.environment'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">
          {formatEnvironment(job.targetEnvironment)}
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
      header: t('column.date'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(job.createdAt)}</span>
      ),
      className: "w-24",
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{t('timeline.restores.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        {hasRestores ? (
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
            icon={<RotateCcw className="h-8 w-8" />}
            title={t('timeline.restores.empty.title')}
            description={t('timeline.restores.empty.description')}
          />
        )}
      </CardContent>
    </Card>
  );
}
