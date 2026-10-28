import { cn } from "@/shared/lib/cn";
import type { StatusSeries } from "./backup-status-series";

interface StatusMarkerProps {
  series: StatusSeries;
  className?: string;
}

/**
 * Rounded square in the status color with a check or a cross: the mark of a
 * bar segment plus a glyph. Decorative; the word beside it names the state.
 */
export function StatusMarker({ series, className }: StatusMarkerProps) {
  const { Icon } = series;
  return (
    <span
      aria-hidden="true"
      className={cn(
        // White on the light-mode fills, near-black on the lighter dark-mode fills.
        "grid size-5 shrink-0 place-items-center rounded-[5px] text-white dark:text-neutral-950",
        className,
      )}
      style={{ backgroundColor: series.color }}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={3.25} />
    </span>
  );
}
