import { ClampText, DataTable, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Database, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BackupJob } from "../types";
import { DumpActions } from "./DumpActions";
import { formatSize } from "@/shared/lib/format";
import { formatDateTimeShort as formatDate, formatEnvironment } from "@/lib/format";
import cloudflareSvg from "@/shared/assets/Cloudflare.svg";
import { EngineName } from "@/shared/components/EngineIcon";
import { cn } from "@/shared/lib/cn";

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
  const { t } = useTranslation(['dumps', 'common'])
  const start = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);

  // Narrower than 42rem each backup becomes a card: the connection with its
  // actions, then the environment and the date, then the status (with the
  // error, in full) and the size. Origin and storage stay in wide tables.
  // From 42rem the columns are fixed and the connection takes the rest, with
  // the environment as its second line instead of a column.
  const columns: Column<BackupJob>[] = [
    {
      header: t('column.connection'),
      accessor: (job) => {
        const name = job.connectionName ?? t('common:connection.deleted');
        return (
          <EngineName dbType={job.dbType}>
            {/* In a card the wrapper steps aside: the name is the card's title. */}
            <div className="flex min-w-0 flex-col gap-0.5 @max-2xl/table:contents">
              <ClampText
                text={name}
                className={cn(
                  "min-w-0 truncate font-medium text-sm @max-2xl/table:whitespace-normal @max-2xl/table:[overflow-wrap:anywhere]",
                  job.connectionName === null && "text-muted-foreground italic",
                )}
              />
              <span className="truncate text-xs text-muted-foreground @max-2xl/table:hidden">
                {formatEnvironment(job.environment)}
              </span>
            </div>
          </EngineName>
        );
      },
      align: "left",
      stack: "title",
    },
    {
      header: t('column.environment'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">{formatEnvironment(job.environment)}</span>
      ),
      stack: "meta",
      stackOnly: true,
    },
    {
      header: t('column.date'),
      accessor: (job) => (
        <time dateTime={job.createdAt} className="text-xs text-muted-foreground whitespace-nowrap @2xl/table:tabular-nums">
          {formatDate(job.createdAt)}
        </time>
      ),
      width: "w-42",
      align: "left",
      stack: "meta",
    },
    {
      header: t('column.origin'),
      accessor: (job) => (
        <span className="text-xs text-muted-foreground">
          {job.triggeredBy === "system-cronjob" ? t('origin.cronjob') : t('origin.manual')}
        </span>
      ),
      width: "w-18",
      align: "left",
      priority: 3,
    },
    {
      header: t('column.status'),
      accessor: (job) => {
        const errorText =
          job.status === "failed" && job.errorMessage
            ? formatHumanErrorMessage(job.errorMessage, t)
            : undefined;
        return (
          <div className="flex flex-col items-center gap-1 @2xl/table:items-start @max-2xl/table:flex-row @max-2xl/table:flex-wrap @max-2xl/table:gap-x-2">
            <StatusBadge status={job.status} />
            {errorText && (
              <div
                className="flex items-center justify-center gap-1 max-w-[200px] text-[11px] text-error font-medium cursor-help @2xl/table:max-w-full @2xl/table:justify-start @max-2xl/table:max-w-none"
                title={job.errorMessage ?? undefined}
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="truncate @max-2xl/table:whitespace-normal">{errorText}</span>
              </div>
            )}
          </div>
        );
      },
      width: "w-32",
      align: "left",
      stack: "field",
    },
    {
      header: t('column.storage'),
      accessor: () => (
        <div className="flex items-center">
          <img
            src={cloudflareSvg}
            alt="Cloudflare R2"
            className="h-4 w-4 shrink-0"
          />
        </div>
      ),
      width: "w-34",
      align: "left",
      priority: 3,
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
      width: "w-24",
      align: "right",
      stack: "field",
    },
    {
      header: t('column.actions'),
      accessor: (job) => (
        <div className="flex items-center justify-center @2xl/table:justify-start">
          <DumpActions job={job} />
        </div>
      ),
      width: "w-44",
      align: "left",
      stack: "actions",
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
        caption={t('nav.dumps', { ns: 'common' })}
        narrowLayout="stack"
        layout="fixed"
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
