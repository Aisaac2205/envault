import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { cva, type VariantProps } from "class-variance-authority";

/* -------------------------------------------------------------------------- */
/*  Variants                                                                  */
/* -------------------------------------------------------------------------- */

const paginationLinkVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      active: {
        true: "bg-accent-soft text-accent relative",
        false: "hover:bg-muted",
      },
    },
    defaultVariants: {
      active: false,
    },
  },
);

/* -------------------------------------------------------------------------- */
/*  Pagination                                                                */
/* -------------------------------------------------------------------------- */

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  className?: string;
}

function Pagination({ className, ...props }: PaginationProps) {
  const { t } = useTranslation("common");
  return (
    <nav
      role="navigation"
      aria-label={t("pagination.ariaLabel")}
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}
Pagination.displayName = "Pagination";

/* -------------------------------------------------------------------------- */
/*  PaginationContent                                                         */
/* -------------------------------------------------------------------------- */

export interface PaginationContentProps extends React.HTMLAttributes<HTMLUListElement> {
  className?: string;
}

function PaginationContent({ className, ...props }: PaginationContentProps) {
  return (
    <ul
      className={cn("flex flex-row flex-wrap items-center gap-1", className)}
      {...props}
    />
  );
}
PaginationContent.displayName = "PaginationContent";

/* -------------------------------------------------------------------------- */
/*  PaginationItem                                                            */
/* -------------------------------------------------------------------------- */

export interface PaginationItemProps extends React.HTMLAttributes<HTMLLIElement> {
  className?: string;
}

/**
 * When the room is short only Previous, the current page and Next stay: an
 * item holding another page link or the ellipsis hides, so the controls fit
 * on one line instead of wrapping. The range text beside them says where you
 * are. "Short" is a DataTable footer (the `pagination` container) narrower
 * than 32rem, or a viewport below `sm` anywhere else.
 */
function PaginationItem({ className, ...props }: PaginationItemProps) {
  return (
    <li
      className={cn(
        "max-sm:has-[>[data-slot=pagination-link]:not([aria-current])]:hidden max-sm:has-[>[data-slot=pagination-ellipsis]]:hidden",
        "@max-lg/pagination:has-[>[data-slot=pagination-link]:not([aria-current])]:hidden @max-lg/pagination:has-[>[data-slot=pagination-ellipsis]]:hidden",
        className,
      )}
      {...props}
    />
  );
}
PaginationItem.displayName = "PaginationItem";

/* -------------------------------------------------------------------------- */
/*  PaginationLink                                                            */
/* -------------------------------------------------------------------------- */

export interface PaginationLinkProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof paginationLinkVariants> {
  isActive?: boolean;
}

function PaginationLink({
  className,
  isActive,
  children,
  ...props
}: PaginationLinkProps) {
  return (
    <button
      data-slot="pagination-link"
      aria-current={isActive ? "page" : undefined}
      className={cn(
        paginationLinkVariants({ active: isActive }),
        "min-w-11 h-11 px-2 sm:min-w-9 sm:h-9",
        isActive && "ring-1 ring-accent/20",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
PaginationLink.displayName = "PaginationLink";

/* -------------------------------------------------------------------------- */
/*  PaginationPrevious                                                        */
/* -------------------------------------------------------------------------- */

export interface PaginationPreviousProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

function PaginationPrevious({
  className,
  label,
  ...props
}: PaginationPreviousProps) {
  const { t } = useTranslation("common");
  const resolvedLabel = label ?? t("pagination.previous");
  return (
    <button
      aria-label={t("pagination.ariaPrevious")}
      className={cn(
        paginationLinkVariants({ active: false }),
        "min-w-11 h-11 gap-1 px-2 sm:min-w-9 sm:h-9",
        className,
      )}
      {...props}
    >
      <ChevronLeft className="h-4 w-4" />
      <span className="hidden sm:inline">{resolvedLabel}</span>
    </button>
  );
}
PaginationPrevious.displayName = "PaginationPrevious";

/* -------------------------------------------------------------------------- */
/*  PaginationNext                                                            */
/* -------------------------------------------------------------------------- */

export interface PaginationNextProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

function PaginationNext({
  className,
  label,
  ...props
}: PaginationNextProps) {
  const { t } = useTranslation("common");
  const resolvedLabel = label ?? t("pagination.next");
  return (
    <button
      aria-label={t("pagination.ariaNext")}
      className={cn(
        paginationLinkVariants({ active: false }),
        "min-w-11 h-11 gap-1 px-2 sm:min-w-9 sm:h-9",
        className,
      )}
      {...props}
    >
      <span className="hidden sm:inline">{resolvedLabel}</span>
      <ChevronRight className="h-4 w-4" />
    </button>
  );
}
PaginationNext.displayName = "PaginationNext";

/* -------------------------------------------------------------------------- */
/*  PaginationEllipsis                                                        */
/* -------------------------------------------------------------------------- */

export interface PaginationEllipsisProps extends React.HTMLAttributes<HTMLSpanElement> {
  className?: string;
}

function PaginationEllipsis({ className, ...props }: PaginationEllipsisProps) {
  return (
    <span
      data-slot="pagination-ellipsis"
      aria-hidden
      className={cn("flex h-9 w-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="h-4 w-4" />
    </span>
  );
}
PaginationEllipsis.displayName = "PaginationEllipsis";

/* -------------------------------------------------------------------------- */
/*  Exports                                                                   */
/* -------------------------------------------------------------------------- */

export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
