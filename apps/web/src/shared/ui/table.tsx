import { useRef, type RefObject } from "react";
import { cn } from "@/shared/lib/cn";
import { useScrollOverflow } from "@/shared/hooks/useScrollOverflow";

function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  );
}

function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-muted/40 [&_tr]:border-0", className)} {...props} />;
}

function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}

function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        "bg-muted/50 font-medium",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:not(:first-child)]:text-center [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("p-4 align-middle [&:not(:first-child)]:text-center [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

interface TableScrollRegionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** For callers that also move the scroll position (a reset on filter change). */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

/**
 * The scroll container around a table: a region (name it with aria-label or
 * aria-labelledby) that joins the tab order only while its content overflows,
 * so keyboard users can scroll it (WCAG 2.1.1) without a useless tab stop.
 * The focus outline is inset because the wrapper usually clips its overflow.
 * It is positioned so that it contains the visually hidden (absolute) text of
 * its table: a hidden header in the last column would otherwise sit past the
 * scroller's edge, outside it, and widen the whole page.
 */
function TableScrollRegion({ scrollRef, className, ...props }: TableScrollRegionProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? ownRef;
  const overflowing = useScrollOverflow(ref);
  return (
    <div
      ref={ref}
      role="region"
      tabIndex={overflowing ? 0 : undefined}
      className={cn("relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring", className)}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollRegion,
};
