import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState } from "@/shared/ui/empty-state";

export interface Column<T> {
  header: ReactNode;
  accessor: (item: T) => ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  emptyContent?: ReactNode;
  className?: string;
  compact?: boolean;
  /** Number of skeleton rows to display when loading. Defaults to 5. */
  skeletonRows?: number;
  /** Slot rendered below the table for pagination or other footer controls. */
  pagination?: ReactNode;
  /**
   * Makes each row navigable. A real link is rendered in a trailing cell and
   * stretched over the row with an ::after overlay, so the whole row is
   * clickable while the DOM still holds exactly one focusable, screen-reader
   * announced control per row. Double-click is deliberately not used: it has
   * no keyboard equivalent, does not exist on touch, and would hijack the
   * text-selection gesture users need to copy ids out of these tables.
   */
  rowHref?: (item: T) => string;
  /** Accessible name for the row link. Falls back to a generic label. */
  rowLinkLabel?: (item: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyMessage,
  emptyContent,
  className,
  compact = false,
  skeletonRows = 5,
  pagination,
  rowHref,
  rowLinkLabel,
}: DataTableProps<T>) {
  const { t } = useTranslation("common");
  const resolvedEmptyMessage = emptyMessage ?? t("empty.data");
  const headPadding = compact ? "px-3 py-2.5" : "px-6 py-4";
  const cellPadding = compact ? "px-3 py-2.5" : "px-6 py-4";
  const wrapperClass = className ?? "rounded-xl bg-card shadow-sm border border-border/60 overflow-hidden";
  const minWidth = compact ? "" : "min-w-[360px]";
  const totalColumns = columns.length + (rowHref ? 1 : 0);

  return (
    <div
      className={cn(
        wrapperClass,
        "[&_tbody]:[[data-loaded]_&]:opacity-100 @starting-style:[&_tbody]:[[data-loaded]_&]:opacity-0",
        "[&_tbody]:transition-opacity [&_tbody]:duration-[var(--duration-normal)]",
      )}
      data-loaded=""
    >
      <div className="overflow-x-auto">
        <Table className={minWidth}>
          <TableHeader>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead
                  key={i}
                  className={cn(headPadding, "text-sm font-medium text-muted-foreground truncate", col.headerClassName)}
                >
                  {col.header}
                </TableHead>
              ))}
              {rowHref ? <TableHead className={cn(headPadding, "w-10")} /> : null}
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, rowIdx) => (
                <TableRow
                  key={`skeleton-row-${rowIdx}`}
                  className="border-b border-border/40 hover:bg-transparent"
                >
                  {columns.map((_, colIdx) => (
                    <TableCell
                      key={`skeleton-cell-${colIdx}`}
                      className={cn(cellPadding, "align-middle")}
                    >
                      <Skeleton className="h-4 w-4/5 mx-auto rounded" />
                    </TableCell>
                  ))}
                  {rowHref ? (
                    <TableCell className={cn(cellPadding, "align-middle w-10")}>
                      <Skeleton className="size-4 rounded mx-auto" />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={totalColumns}
                  className="h-64 text-center align-middle"
                >
                  {emptyContent ?? (
                    <EmptyState
                      icon={<Inbox className="size-6 text-muted-foreground/60" />}
                      title={resolvedEmptyMessage}
                      className="py-8"
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, rowIdx) => (
                <TableRow
                  key={rowIdx}
                  className={cn(
                    "transition-colors hover:bg-muted/30",
                    rowHref && "relative focus-within:bg-muted/30",
                  )}
                >
                  {columns.map((col, colIdx) => (
                    <TableCell
                      key={colIdx}
                      className={cn(cellPadding, "align-middle", col.className)}
                    >
                      {col.accessor(item)}
                    </TableCell>
                  ))}
                  {rowHref ? (
                    <TableCell className={cn(cellPadding, "align-middle w-10")}>
                      <Link
                        to={rowHref(item)}
                        aria-label={rowLinkLabel?.(item) ?? t("actions.viewDetail")}
                        className={cn(
                          "inline-flex items-center justify-center rounded-md text-muted-foreground",
                          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          // Stretches the link over the whole row without adding
                          // a second interactive element to the accessibility tree.
                          "after:absolute after:inset-0 after:content-['']",
                        )}
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && (
        <div className="flex items-center justify-end border-t px-4 py-3">
          {pagination}
        </div>
      )}
    </div>
  );
}