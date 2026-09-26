import { cn } from "@/shared/lib/cn";

export interface MicroHistogramProps {
  /** Typically the last 7 days, oldest first — the last entry is "today". */
  data: number[];
  ariaLabel: string;
}

/**
 * Micro-histogram sparkline flush beside a KPI figure (AGENTS §3): CSS bars,
 * not SVG. History bars use a muted neutral; the last (today) bar carries
 * the chart-1 accent.
 */
export function MicroHistogram({ data, ariaLabel }: MicroHistogramProps) {
  if (data.length === 0) return null;

  const max = Math.max(...data, 1);

  return (
    <div className="flex h-5 items-end gap-px" role="img" aria-label={ariaLabel}>
      {data.map((value, index) => {
        const isToday = index === data.length - 1;
        const heightPct = value > 0 ? Math.max((value / max) * 100, 15) : 6;
        return (
          <span
            key={index}
            aria-hidden="true"
            className={cn("w-1 rounded-[1px]", isToday ? "bg-chart-1" : "bg-text-secondary/50")}
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}
