import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollRegion,
} from "@/shared/ui/table";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronRight, Inbox } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui/skeleton";
import { EmptyState } from "@/shared/ui/empty-state";

/**
 * Where a cell goes when the table reflows into stacked rows:
 * - `title`: first line, takes the remaining width.
 * - `badge`: first line, after the title (a status or an environment).
 * - `actions`: first line, at the end, above the row link.
 * - `meta`: second line, inline with the other meta cells (a time, an actor).
 * - `field`: a line of its own, after a visual label.
 * - `footer`: the last line, full width and unlabelled, above the row link;
 *   for controls that need the room (a result beside its action menu).
 */
export type StackRole = "title" | "badge" | "meta" | "field" | "actions" | "footer";

/**
 * How long a column survives as the table narrows, measured on the table's
 * own width (container query), not the viewport: 1 always shows, 2 hides
 * below 42rem (phones and stacked rows), 3 also hides below 56rem. A higher
 * number hides first; the data must stay reachable elsewhere (a detail view).
 */
export type ColumnPriority = 1 | 2 | 3;

export interface Column<T> {
  header: ReactNode;
  accessor: (item: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** Role in the stacked layout (`narrowLayout="stack"`). Defaults to `field`. */
  stack?: StackRole;
  /** Label of a `field` cell in the stacked layout. Defaults to `header`. */
  stackLabel?: ReactNode;
  /** Defaults to 1: the column never hides. */
  priority?: ColumnPriority;
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
  /**
   * Names the table: a visually hidden <caption> that also names the scroll
   * region around it. Without it the region gets a generic name.
   */
  caption?: string;
  /**
   * What happens when the table is narrower than 42rem. `scroll` (default)
   * keeps the columns and scrolls sideways; `stack` turns every row into a
   * card laid out by each column's `stack` role, with the same DOM.
   */
  narrowLayout?: "scroll" | "stack";
}

/*
 * Tailwind only generates class names it finds written out, so every
 * responsive class below is a literal. `/table` is the container on the
 * DataTable root: the layout follows the room the table has, not the viewport.
 */

const PRIORITY_CLASSES: Record<ColumnPriority, string> = {
  1: "",
  2: "@max-2xl/table:hidden",
  3: "@max-4xl/table:hidden",
};

// Table semantics survive these display changes in current engines; never
// use display:contents here, which drops the rows from the accessibility tree.
const STACKED_TABLE = "@max-2xl/table:block @max-2xl/table:min-w-0";
const STACKED_HEADER = "@max-2xl/table:sr-only";
const STACKED_BODY = "@max-2xl/table:block";

/*
 * A stacked row is one wrapping flex line. Title, badge and actions share the
 * first line; the row's ::before is a full-width, zero-height item that breaks
 * the line; meta cells follow inline, and each field takes a line of its own.
 * Spacing comes from margins because a row gap would also open around the break.
 */
const STACKED_ROW =
  "@max-2xl/table:flex @max-2xl/table:flex-wrap @max-2xl/table:items-center @max-2xl/table:gap-x-2 @max-2xl/table:px-4 @max-2xl/table:py-3 @max-2xl/table:border-b @max-2xl/table:border-border/60 @max-2xl/table:before:order-4 @max-2xl/table:before:basis-full";

const STACKED_CELL =
  "@max-2xl/table:flex @max-2xl/table:w-auto @max-2xl/table:min-w-0 @max-2xl/table:items-center @max-2xl/table:p-0 @max-2xl/table:text-left! @max-2xl/table:*:min-w-0";

const STACKED_ROLE_CLASSES: Record<StackRole, string> = {
  title: "@max-2xl/table:order-1 @max-2xl/table:flex-1 @max-2xl/table:basis-0",
  badge: "@max-2xl/table:order-2 @max-2xl/table:shrink-0",
  actions: "@max-2xl/table:order-3 @max-2xl/table:ml-auto @max-2xl/table:shrink-0",
  meta: "@max-2xl/table:order-5 @max-2xl/table:mt-1",
  field:
    "@max-2xl/table:order-6 @max-2xl/table:mt-1.5 @max-2xl/table:basis-full @max-2xl/table:items-baseline @max-2xl/table:gap-2",
  footer: "@max-2xl/table:order-7 @max-2xl/table:mt-2 @max-2xl/table:basis-full",
};

/** Roles holding controls: they sit above the stretched row link. */
const INTERACTIVE_ROLES: ReadonlySet<StackRole> = new Set(["actions", "footer"]);

/** A middle dot between meta cells that share the second line. */
const META_SEPARATOR =
  "@max-2xl/table:before:mr-2 @max-2xl/table:before:text-muted-foreground @max-2xl/table:before:content-['·']";

/*
 * A loading card has the loaded card's lines: a bar for the title, one for
 * the meta line and one per field. Badges, actions and further meta cells
 * share those lines, so they draw no bar of their own.
 */
const STACKED_SKELETON_ROW =
  "@max-2xl/table:flex @max-2xl/table:flex-col @max-2xl/table:gap-2 @max-2xl/table:px-4 @max-2xl/table:py-3";
const STACKED_SKELETON_CELL = "@max-2xl/table:block @max-2xl/table:p-0";
const STACKED_SKELETON_LINE: Record<StackRole, string> = {
  title: "@max-2xl/table:order-1",
  meta: "@max-2xl/table:order-5",
  field: "@max-2xl/table:order-6",
  badge: "",
  actions: "",
  footer: "",
};
const STACKED_SKELETON_BAR: Record<StackRole, string> = {
  title: "@max-2xl/table:mx-0 @max-2xl/table:w-3/5",
  meta: "@max-2xl/table:mx-0 @max-2xl/table:w-2/5",
  field: "@max-2xl/table:mx-0 @max-2xl/table:w-4/5",
  badge: "",
  actions: "",
  footer: "",
};

/** The row link's cell collapses; its ::after still covers the whole card. */
const STACKED_LINK_CELL = "@max-2xl/table:order-last @max-2xl/table:size-0 @max-2xl/table:p-0";
const STACKED_LINK =
  "@max-2xl/table:focus-visible:ring-0 @max-2xl/table:focus-visible:after:ring-2 @max-2xl/table:focus-visible:after:ring-inset @max-2xl/table:focus-visible:after:ring-ring";

/**
 * The label of a field in the stacked layout, hidden in the table layout.
 * Visual only: screen readers already pair the cell with its column header.
 */
export function StackFieldLabel({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="hidden shrink-0 text-xs text-muted-foreground @max-2xl/table:inline">
      {children}
    </span>
  );
}

/**
 * The stacked layout as classes, for a raw <Table> whose layout DataTable
 * does not offer (RestoreHistory: a full-height pane with a sticky header).
 * `container` goes on an ancestor of the table.
 */
// eslint-disable-next-line react-refresh/only-export-components -- layout classes co-located with the DataTable that defines them, so both layouts stay one definition
export const stackedTableClasses = {
  container: "@container/table",
  table: STACKED_TABLE,
  header: STACKED_HEADER,
  body: STACKED_BODY,
  row: STACKED_ROW,
  /** For rows and cells that stay one block, such as the empty state. */
  block: "@max-2xl/table:block",
  cell: (role: StackRole, options: { afterMeta?: boolean } = {}) =>
    cn(
      STACKED_CELL,
      STACKED_ROLE_CLASSES[role],
      INTERACTIVE_ROLES.has(role) && "relative z-10",
      options.afterMeta && META_SEPARATOR,
    ),
} as const;

function priorityOf<T>(column: Column<T>): ColumnPriority {
  return column.priority ?? 1;
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
  caption,
  narrowLayout = "scroll",
}: DataTableProps<T>) {
  const { t } = useTranslation("common");
  const captionId = useId();

  const stacked = narrowLayout === "stack";
  const responsive = stacked || columns.some((col) => priorityOf(col) > 1);
  const resolvedEmptyMessage = emptyMessage ?? t("empty.data");
  const headPadding = compact ? "px-3 py-2.5" : "px-6 py-4";
  const cellPadding = compact ? "px-3 py-2.5" : "px-6 py-4";
  const wrapperClass = className ?? "rounded-xl bg-card shadow-sm border border-border/60 overflow-hidden";
  const minWidth = compact ? "" : "min-w-[360px]";
  const totalColumns = columns.length + (rowHref ? 1 : 0);
  const firstMetaIndex = columns.findIndex((col) => col.stack === "meta" && priorityOf(col) === 1);

  /** A column hidden below 42rem never takes part in the stacked layout. */
  const stacksAt = (col: Column<T>) => stacked && priorityOf(col) === 1;

  const skeletonDrawsBar = (col: Column<T>, colIdx: number) => {
    const role = col.stack ?? "field";
    return role === "title" || role === "field" || colIdx === firstMetaIndex;
  };

  const cellClass = (col: Column<T>, colIdx: number) => {
    const role = col.stack ?? "field";
    return cn(
      cellPadding,
      "align-middle",
      col.className,
      INTERACTIVE_ROLES.has(role) && "relative z-10",
      stacksAt(col) && STACKED_CELL,
      stacksAt(col) && STACKED_ROLE_CLASSES[role],
      stacksAt(col) && role === "meta" && colIdx !== firstMetaIndex && META_SEPARATOR,
      PRIORITY_CLASSES[priorityOf(col)],
    );
  };

  return (
    <div
      className={cn(
        wrapperClass,
        responsive && "@container/table",
        "[&_tbody]:[[data-loaded]_&]:opacity-100 @starting-style:[&_tbody]:[[data-loaded]_&]:opacity-0",
        "[&_tbody]:transition-opacity [&_tbody]:duration-[var(--duration-normal)]",
      )}
      data-loaded=""
    >
      <TableScrollRegion
        aria-labelledby={caption ? captionId : undefined}
        aria-label={caption ? undefined : t("label.dataTable")}
        className="overflow-x-auto"
      >
        <Table className={cn(minWidth, stacked && STACKED_TABLE)}>
          {caption ? (
            <caption id={captionId} className="sr-only">
              {caption}
            </caption>
          ) : null}
          <TableHeader className={cn(stacked && STACKED_HEADER)}>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    headPadding,
                    "text-sm font-medium text-muted-foreground truncate",
                    col.headerClassName,
                    PRIORITY_CLASSES[priorityOf(col)],
                  )}
                >
                  {col.header}
                </TableHead>
              ))}
              {rowHref ? <TableHead className={cn(headPadding, "w-10")} /> : null}
            </TableRow>
          </TableHeader>

          <TableBody className={cn(stacked && STACKED_BODY)}>
            {loading ? (
              Array.from({ length: skeletonRows }).map((_, rowIdx) => (
                <TableRow
                  key={`skeleton-row-${rowIdx}`}
                  className={cn("border-b border-border/40 hover:bg-transparent", stacked && STACKED_SKELETON_ROW)}
                >
                  {columns.map((col, colIdx) => (
                    <TableCell
                      key={`skeleton-cell-${colIdx}`}
                      className={cn(
                        cellPadding,
                        "align-middle",
                        stacksAt(col) &&
                          (skeletonDrawsBar(col, colIdx)
                            ? cn(STACKED_SKELETON_CELL, STACKED_SKELETON_LINE[col.stack ?? "field"])
                            : "@max-2xl/table:hidden"),
                        PRIORITY_CLASSES[priorityOf(col)],
                      )}
                    >
                      <Skeleton
                        className={cn("h-4 w-4/5 mx-auto rounded", stacksAt(col) && STACKED_SKELETON_BAR[col.stack ?? "field"])}
                      />
                    </TableCell>
                  ))}
                  {rowHref ? (
                    <TableCell className={cn(cellPadding, "align-middle w-10", stacked && "@max-2xl/table:hidden")}>
                      <Skeleton className="size-4 rounded mx-auto" />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow className={cn("hover:bg-transparent", stacked && "@max-2xl/table:block")}>
                <TableCell
                  colSpan={totalColumns}
                  className={cn("h-64 text-center align-middle", stacked && "@max-2xl/table:block")}
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
                    stacked && STACKED_ROW,
                  )}
                >
                  {columns.map((col, colIdx) => (
                    <TableCell key={colIdx} className={cellClass(col, colIdx)}>
                      {stacksAt(col) && (col.stack ?? "field") === "field" ? (
                        <StackFieldLabel>{col.stackLabel ?? col.header}</StackFieldLabel>
                      ) : null}
                      {col.accessor(item)}
                    </TableCell>
                  ))}
                  {rowHref ? (
                    <TableCell className={cn(cellPadding, "align-middle w-10", stacked && STACKED_LINK_CELL)}>
                      <Link
                        to={rowHref(item)}
                        aria-label={rowLinkLabel?.(item) ?? t("actions.viewDetail")}
                        className={cn(
                          "inline-flex items-center justify-center rounded-md text-muted-foreground",
                          "outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          // Stretches the link over the whole row without adding
                          // a second interactive element to the accessibility tree.
                          "after:absolute after:inset-0 after:content-['']",
                          stacked && STACKED_LINK,
                        )}
                      >
                        <ChevronRight
                          className={cn("h-4 w-4", stacked && "@max-2xl/table:hidden")}
                          aria-hidden="true"
                        />
                      </Link>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScrollRegion>
      {pagination && (
        // Outside the scroller, so it never scrolls away; it wraps instead of
        // being clipped by the rounded wrapper, and as the `pagination`
        // container it lets the controls compact to the room they have.
        <div className="@container/pagination flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          {pagination}
        </div>
      )}
    </div>
  );
}
