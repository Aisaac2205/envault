import type { ReactNode } from "react";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";
import { SectionState, type SectionStatus } from "./SectionState";

export type { SectionStatus };

export interface SectionProps {
  id: string;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  status: SectionStatus;
  skeleton: ReactNode;
  empty?: ReactNode;
  onRetry?: () => void;
  isStale?: boolean;
  children: ReactNode;
}

/**
 * Shared section vocabulary for the redesigned dashboard: an h2 row (title,
 * meta, action) sitting OUTSIDE the surface, plus one dual-layer Card
 * (default variant) — no CardHeader, no DataTable wrapper, no nested cards.
 */
export function Section({
  id,
  title,
  meta,
  action,
  status,
  skeleton,
  empty,
  onRetry,
  isStale,
  children,
}: SectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
        {(meta || action) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {meta}
            {action}
          </div>
        )}
      </div>
      <Card
        variant="default"
        className={cn(
          "p-4",
          isStale && "opacity-60 transition-opacity duration-150 motion-reduce:transition-none",
        )}
        aria-busy={isStale || undefined}
      >
        <SectionState status={status} skeleton={skeleton} empty={empty} onRetry={onRetry}>
          {children}
        </SectionState>
      </Card>
    </section>
  );
}
