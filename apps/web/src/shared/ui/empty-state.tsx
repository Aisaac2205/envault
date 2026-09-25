import { type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center select-none",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-muted-foreground shadow-xs ring-1 ring-border/20 [&>svg]:size-6">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold tracking-tight text-text-primary">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground text-balance leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-5 flex items-center justify-center gap-3">
          {action}
        </div>
      )}
    </div>
  );
}
