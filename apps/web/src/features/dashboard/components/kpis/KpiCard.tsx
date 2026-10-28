import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui/skeleton";

interface KpiCardProps {
  label: string;
  /** A 16px icon. It is decoration: the label names the card. */
  icon: ReactNode;
  /** A CSS color (`var(--chart-1)`) that tints the icon chip, the top wash and the hover border. */
  accent: string;
  /** The headline figure, in the first paragraph of the group. */
  value: ReactNode;
  /** One line under the figure: the context, or the day under the pointer. */
  caption?: ReactNode;
  /** What fills the bottom of the card: a sparkline, or a detail row. */
  visual?: ReactNode;
  /** The figure is on its way: skeletons keep the card's size. */
  loading?: boolean;
  className?: string;
}

/**
 * A dashboard KPI: one labelled group (the label names it for assistive
 * technology) with a headline figure, a caption and a visual. Presentational: the
 * numbers, the loading state and the hover caption come from the caller.
 */
export function KpiCard({
  label,
  icon,
  accent,
  value,
  caption,
  visual,
  loading = false,
  className,
}: KpiCardProps) {
  const labelId = useId();

  return (
    <div
      aria-busy={loading || undefined}
      aria-labelledby={labelId}
      className={cn(
        "group/kpi relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-xs transition-[border-color,box-shadow] duration-200 ease-out motion-reduce:transition-none sm:p-5",
        "hover:border-[color-mix(in_oklab,var(--kpi-accent)_55%,var(--color-border))] hover:shadow-md",
        className,
      )}
      role="group"
      style={{ "--kpi-accent": accent } as CSSProperties}
    >
      {/* A wash of the accent from the top edge: it tells the four cards apart at a glance. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-[color-mix(in_oklab,var(--kpi-accent)_11%,transparent)] to-transparent"
      />
      <div className="relative flex min-h-9 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--kpi-accent)_16%,transparent)] text-[var(--kpi-accent)] [&>svg]:size-4"
        >
          {icon}
        </span>
        <h3 className="min-w-0 text-sm font-medium leading-tight text-text-secondary" id={labelId}>
          {label}
        </h3>
      </div>
      <div className="relative mt-4">
        {loading ? (
          <Skeleton className="h-8 w-28 motion-reduce:animate-none" />
        ) : (
          <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-text-primary">
            {value}
          </p>
        )}
      </div>
      <div className="relative mt-2 min-h-4">
        {loading ? (
          <Skeleton className="h-3.5 w-36 motion-reduce:animate-none" />
        ) : (
          <p className="text-xs leading-4 text-text-secondary tabular-nums">{caption}</p>
        )}
      </div>
      <div className="relative mt-3 flex min-h-11 flex-1 items-end">
        {loading ? <Skeleton className="h-11 w-full motion-reduce:animate-none" /> : visual}
      </div>
    </div>
  );
}
