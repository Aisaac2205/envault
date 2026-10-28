import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { QUICK_RANGE_DAYS, type QuickRangeDays } from "./dump-duration-data";

interface QuickRangeControlProps {
  /** The preset the chart is showing, or `null` for a custom (brushed) range. */
  value: QuickRangeDays | null;
  onSelect: (days: QuickRangeDays) => void;
}

/**
 * 7d / 30d / 90d: the keyboard way to set the brush range. 90d shows the whole
 * window, so it doubles as the reset. Dragging the brush to another range
 * leaves every button unpressed.
 */
export function QuickRangeControl({ value, onSelect }: QuickRangeControlProps) {
  const { t } = useTranslation("dashboard");

  return (
    <div
      aria-label={t("duration.range.label")}
      className="flex w-full gap-0.5 rounded-lg border border-border bg-muted p-0.5 sm:inline-flex sm:w-auto"
      role="group"
    >
      {QUICK_RANGE_DAYS.map((days) => {
        const pressed = value === days;
        return (
          <button
            aria-pressed={pressed}
            className={cn(
              "h-9 flex-1 rounded-md px-3.5 text-xs font-medium tabular-nums transition-[background-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text-primary pointer-coarse:h-11 pointer-coarse:min-w-14 sm:flex-none",
              pressed
                ? "bg-card text-text-primary shadow-xs"
                : "text-text-secondary hover:text-text-primary",
            )}
            key={days}
            onClick={() => onSelect(days)}
            type="button"
          >
            {t("duration.range.option", { days })}
          </button>
        );
      })}
    </div>
  );
}
