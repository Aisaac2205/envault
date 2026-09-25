import { DataTable, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import { ConnectionLabel } from "@/shared/components/ConnectionLabel";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/shared/ui/pagination";
import { useTranslation } from "react-i18next";
import { formatDateTimeShort, formatEnvironment } from "@/lib/format";
import {
  Trash2,
  Pencil,
  Plus,
  LogIn,
  LogOut,
  KeyRound,
  FileText,
  ClipboardList,
} from "lucide-react";
import type { AuditLog } from "../types";

interface AuditTableProps {
  logs: AuditLog[];
  isLoading: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function shortenId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// Keyed on what the backend actually writes. The AuditInterceptor stores
// "<METHOD> <path>" and the Better Auth hook stores "auth.<endpoint>" — an
// earlier map keyed on names like "backup.created" that nothing ever
// produced, so every row silently fell through to the default icon.
const AUTH_ACTION_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  "auth.sign-in.email": LogIn,
  "auth.sign-out": LogOut,
  "auth.change-password": KeyRound,
};

const METHOD_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  POST: Plus,
  PUT: Pencil,
  PATCH: Pencil,
  DELETE: Trash2,
};

function ActionCell({ action }: { action: string }) {
  const Icon =
    AUTH_ACTION_ICONS[action] ?? METHOD_ICONS[action.split(" ")[0]] ?? FileText;
  return (
    <div className="inline-flex items-center justify-center gap-2 max-w-full">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-xs text-text-primary font-medium truncate">{action}</span>
    </div>
  );
}

function formatResourceType(type: string): string {
  if (!type) return "";
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function MetadataCell({ log }: { log: AuditLog }) {
  const meta = log.metadata ?? {};
  const metaName =
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.connectionName === "string" && meta.connectionName) ||
    undefined;

  const showId = log.resourceId && log.resourceId !== "unknown";
  const formattedType = formatResourceType(log.resourceType);

  return (
    <div className="inline-flex items-center justify-center gap-2 max-w-full py-0.5">
      {log.resourceType === "connection" ? (
        <ConnectionLabel id={log.resourceId} name={metaName} className="text-xs truncate font-medium" />
      ) : metaName ? (
        <span className="text-xs font-medium text-text-primary truncate" title={`${metaName} (${log.resourceId})`}>
          {metaName}
        </span>
      ) : showId ? (
        <span
          className="text-xs text-muted-foreground tabular-nums truncate"
          title={log.resourceId}
        >
          #{shortenId(log.resourceId)}
        </span>
      ) : null}
      {formattedType && (
        <span className="text-[11px] text-muted-foreground/70 shrink-0 font-medium">
          {formattedType}
        </span>
      )}
    </div>
  );
}

function AuditPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation('audit');
  const totalPages = Math.ceil(total / pageSize);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (page <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      } else if (page >= totalPages - 2) {
        pages.push(1);
        pages.push("...");
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push("...");
        for (let i = page - 1; i <= page + 1; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex w-full items-center justify-between gap-4">
      <p className="text-xs text-muted-foreground whitespace-nowrap">
        {t('showing', { start: startItem, end: endItem, total })}
      </p>
      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
            />
          </PaginationItem>
          {getPageNumbers().map((p, i) =>
            p === "..." ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={page === p}
                  onClick={() => onPageChange(p as number)}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

export default function AuditTable({
  logs,
  isLoading,
  total,
  page,
  pageSize,
  onPageChange,
}: AuditTableProps) {
  const { t } = useTranslation('audit');

  const columns: Column<AuditLog>[] = [
    {
      header: t('column.date'),
      accessor: (log) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
          {formatDateTimeShort(log.createdAt)}
        </span>
      ),
      className: "w-44 text-center hidden sm:table-cell",
      headerClassName: "w-44 text-center hidden sm:table-cell",
    },
    {
      header: t('column.user'),
      accessor: (log) => (
        <span className="text-sm font-medium text-text-primary truncate block text-center">
          {log.username}
        </span>
      ),
      className: "w-36 text-center",
      headerClassName: "w-36 text-center",
    },
    {
      header: t('column.action'),
      accessor: (log) => <ActionCell action={log.action} />,
      className: "text-center",
      headerClassName: "text-center",
    },
    {
      header: t('column.environment'),
      accessor: (log) => (
        <span className="text-xs text-muted-foreground">
          {formatEnvironment(log.environment)}
        </span>
      ),
      className: "w-28 text-center hidden sm:table-cell",
      headerClassName: "w-28 text-center hidden sm:table-cell",
    },
    {
      header: t('column.metadata'),
      accessor: (log) => <MetadataCell log={log} />,
      className: "text-center",
      headerClassName: "text-center",
    },
  ];

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        data={logs}
        loading={isLoading}
        emptyMessage={t('empty.title')}
        emptyContent={
          <EmptyState
            icon={<ClipboardList className="size-6 text-muted-foreground/60" />}
            title={t('empty.title')}
            description={t('empty.description')}
            className="py-6"
          />
        }
        rowHref={(log) => `/audit/${log.id}`}
        rowLinkLabel={(log) => t('detail.linkLabel', { id: log.id })}
        pagination={
          <AuditPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={onPageChange}
          />
        }
      />
    </div>
  );
}
