import { ClampText, DataTable, type Column } from "@/shared/ui/data-table";
import { cn } from "@/shared/lib/cn";
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

function formatResourceType(type: string): string {
  if (!type) return "";
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function metadataNameOf(log: AuditLog): string | undefined {
  const meta = log.metadata ?? {};
  return (
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.connectionName === "string" && meta.connectionName) ||
    undefined
  );
}

function hasResource(log: AuditLog): boolean {
  return Boolean(
    log.resourceType === "connection" ||
      metadataNameOf(log) ||
      (log.resourceId && log.resourceId !== "unknown") ||
      formatResourceType(log.resourceType),
  );
}

function ActionCell({ log }: { log: AuditLog }) {
  const { action } = log;
  const Icon =
    AUTH_ACTION_ICONS[action] ?? METHOD_ICONS[action.split(" ")[0]] ?? FileText;
  return (
    // In a card the wrapper steps aside and the action is the card's title;
    // in the table the resource follows it as a muted second line.
    <div className="flex min-w-0 flex-col gap-0.5 @max-2xl/table:contents">
      <div className="inline-flex min-w-0 items-start justify-start gap-2 max-w-full">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-px @max-2xl/table:mt-[3px]" aria-hidden="true" />
        {/* The path wraps to two lines instead of losing its end. */}
        <ClampText
          text={action}
          className="text-xs text-text-primary font-medium truncate @max-2xl/table:line-clamp-2 @max-2xl/table:whitespace-normal @max-2xl/table:text-sm @max-2xl/table:[overflow-wrap:anywhere]"
        />
      </div>
      {hasResource(log) ? (
        <div className="flex min-w-0 pl-[22px] @max-2xl/table:hidden">
          <MetadataCell log={log} muted />
        </div>
      ) : null}
    </div>
  );
}

function MetadataCell({ log, muted = false }: { log: AuditLog; muted?: boolean }) {
  const metaName = metadataNameOf(log);
  const showId = log.resourceId && log.resourceId !== "unknown";
  const formattedType = formatResourceType(log.resourceType);
  // The second line of the table layout is secondary: muted, and left-aligned under the action.
  const nameTone = muted ? "font-normal text-muted-foreground" : "font-medium text-text-primary";

  return (
    <div className={cn("inline-flex items-center justify-center gap-2 max-w-full py-0.5", muted && "min-w-0 justify-start py-0")}>
      {log.resourceType === "connection" ? (
        <ConnectionLabel id={log.resourceId} name={metaName} className={cn("text-xs truncate font-medium", muted && nameTone)} />
      ) : metaName ? (
        <span className={cn("text-xs truncate", nameTone)} title={`${metaName} (${log.resourceId})`}>
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
    // On a phone the range takes its own line and the controls stay whole.
    <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-xs text-muted-foreground sm:whitespace-nowrap">
        {t('showing', { start: startItem, end: endItem, total })}
      </p>
      <Pagination className="mx-0 ml-auto w-auto">
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

  // Narrower than 42rem each entry becomes a card: the action is the title,
  // the environment a badge beside it, then the time and the actor, then the
  // resource. The time is the key field of an audit log, so it never hides.
  // From 42rem the table has fixed columns: the action takes what the others
  // leave, with the resource as its second line instead of a column.
  const columns: Column<AuditLog>[] = [
    {
      header: t('column.date'),
      accessor: (log) => (
        <time
          dateTime={log.createdAt}
          className="text-xs text-muted-foreground whitespace-nowrap tabular-nums"
        >
          {formatDateTimeShort(log.createdAt)}
        </time>
      ),
      width: "w-42",
      align: "left",
      stack: "meta",
    },
    {
      header: t('column.user'),
      accessor: (log) => (
        <span
          className="text-sm font-medium text-text-primary truncate block @max-2xl/table:text-xs"
          title={log.username}
        >
          {log.username}
        </span>
      ),
      width: "w-40 @4xl/table:w-56",
      align: "left",
      stack: "meta",
    },
    {
      header: t('column.action'),
      accessor: (log) => <ActionCell log={log} />,
      align: "left",
      stack: "title",
    },
    {
      header: t('column.environment'),
      accessor: (log) => (
        <span className="text-xs text-muted-foreground @max-2xl/table:rounded-md @max-2xl/table:bg-muted @max-2xl/table:px-2 @max-2xl/table:py-0.5">
          {formatEnvironment(log.environment)}
        </span>
      ),
      width: "w-28",
      align: "left",
      stack: "badge",
    },
    {
      header: t('column.metadata'),
      accessor: (log) => <MetadataCell log={log} />,
      stack: "field",
      stackOnly: true,
    },
  ];

  return (
    <div className="space-y-2">
      <DataTable
        columns={columns}
        data={logs}
        loading={isLoading}
        caption={t('page.subtitle')}
        narrowLayout="stack"
        layout="fixed"
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
