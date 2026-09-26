import { DataTable, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Database, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BackupJob } from "../types";
import { DumpActions } from "./DumpActions";
import { formatSize } from "@/shared/lib/format";
import { formatDateTimeShort as formatDate, formatEnvironment } from "@/lib/format";
import cloudflareSvg from "@/shared/assets/Cloudflare.svg";

function formatHumanErrorMessage(
  rawError: string,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  if (/ENOENT|spawn (pg_dump|mysqldump|mariadb-dump)/i.test(rawError)) {
    return t("error.binaryNotFound", {
      defaultValue: "Herramienta no disponible",
    });
  }
  if (/password authentication failed/i.test(rawError)) {
    return t("error.authFailed", {
      defaultValue: "Error de acceso",
    });
  }
  if (/ECONNREFUSED|Connection refused/i.test(rawError)) {
    return t("error.connectionRefused", {
      defaultValue: "Conexión rechazada",
    });
  }
  return t("error.genericFailure", {
    defaultValue: "Error en el respaldo",
  });
}

interface DumpsTableProps {
  dumps: BackupJob[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  /** Rendered in the pagination slot below the table. */
  pagination?: React.ReactNode;
}

export function DumpsTable({
  dumps,
  isLoading,
  total,
  page,
  pageSize,
  pagination,
}: DumpsTableProps) {
  const { t } = useTranslation('dumps')
  const start = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);

  const columns: Column<BackupJob>[] = [
    {
      header: t('column.connection'),
      accessor: (job) => (
        <p className="truncate font-medium text-sm" title={job.connectionName}>
          {job.connectionName}
        </p>
      ),
      className: "w-[20%]",
      headerClassName: "w-[20%]",
    },
    {
      header: t('column.environment'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">{formatEnvironment(job.environment)}</span>
      ),
      className: "w-[10%]",
      headerClassName: "w-[10%]",
    },
    {
      header: t('column.date'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(job.createdAt)}
        </span>
      ),
      className: "w-[14%] hidden sm:table-cell",
      headerClassName: "w-[14%] hidden sm:table-cell",
    },
    {
      header: t('column.origin'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">
          {job.triggeredBy === "system-cronjob" ? t('origin.cronjob') : t('origin.manual')}
        </span>
      ),
      className: "w-[11%] hidden sm:table-cell",
      headerClassName: "w-[11%] hidden sm:table-cell",
    },
    {
      header: t('column.status'),
      accessor: (job) => {
        const errorText =
          job.status === "failed" && job.errorMessage
            ? formatHumanErrorMessage(job.errorMessage, t)
            : undefined;
        return (
          <div className="flex flex-col items-center gap-1">
            <StatusBadge status={job.status} />
            {errorText && (
              <div
                className="flex items-center justify-center gap-1 max-w-[200px] text-[11px] text-error font-medium cursor-help"
                title={job.errorMessage ?? undefined}
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">{errorText}</span>
              </div>
            )}
          </div>
        );
      },
      className: "w-[20%]",
      headerClassName: "w-[20%]",
    },
    {
      header: t('column.storage'),
      accessor: () => (
        <div className="flex items-center justify-center">
          <img
            src={cloudflareSvg}
            alt="Cloudflare R2"
            className="h-4 w-4 shrink-0"
          />
        </div>
      ),
      className: "w-[8%] hidden sm:table-cell",
      headerClassName: "w-[8%] hidden sm:table-cell",
    },
    {
      header: t('column.size'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">
          {job.fileSizeMb != null
            ? formatSize(job.fileSizeMb * 1024 * 1024)
            : "-"}
        </span>
      ),
      className: "w-[8%] hidden sm:table-cell",
      headerClassName: "w-[8%] hidden sm:table-cell",
    },
    {
      header: t('column.actions'),
      accessor: (job) => (
        <div className="flex items-center justify-center">
          <DumpActions job={job} />
        </div>
      ),
      className: "w-[11%]",
      headerClassName: "w-[11%]",
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {total > 0
          ? `${t('label.showing', { start, end, total, item: total === 1 ? t('label.record', { ns: 'common' }) : t('label.records', { ns: 'common' }) })}`
          : t('label.noRecords')}
      </p>
      <DataTable
        columns={columns}
        data={dumps}
        loading={isLoading}
        emptyMessage={t('empty.noBackups')}
        emptyContent={
          <EmptyState
            icon={<Database className="size-6 text-muted-foreground/60" />}
            title={t('empty.noResults.title')}
            description={t('empty.noResults.description')}
            className="py-6"
          />
        }
        pagination={pagination}
      />
    </div>
  );
}
