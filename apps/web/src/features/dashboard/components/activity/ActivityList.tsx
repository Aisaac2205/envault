import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export interface ActivityListColumn {
  key: string;
  header: string;
}

export interface ActivityListProps {
  columns: ActivityListColumn[];
  /**
   * Tailwind grid-template-columns utility shared verbatim by the header row
   * and every row so their columns line up at `@xl/activity` and up, e.g.
   * `"@xl/activity:grid-cols-[minmax(0,1fr)_auto_auto_auto]"`.
   */
  gridColsClassName: string;
  children: ReactNode;
  className?: string;
}

/**
 * Shared activity list shell (dashboard-page-shell "Timeline Card Morph" /
 * "Activity Row Detail"): below `@xl` each row stacks as plain 2-line text
 * (owned by the row itself); at `@xl/activity` and up, rows line up as grid
 * columns under this aria-hidden header row. Rows live inside the caller's
 * single Section surface — no nested card here.
 */
export function ActivityList({ columns, gridColsClassName, children, className }: ActivityListProps) {
  return (
    <div className={cn("@container/activity", className)}>
      <div
        aria-hidden="true"
        className={cn(
          "hidden gap-3 pb-2 text-xs text-muted-foreground @xl/activity:grid",
          gridColsClassName,
        )}
      >
        {columns.map((column) => (
          <span key={column.key}>{column.header}</span>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-hairline">{children}</ul>
    </div>
  );
}
