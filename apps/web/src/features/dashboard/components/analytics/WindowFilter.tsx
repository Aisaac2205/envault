import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { ANALYTICS_WINDOWS, type AnalyticsWindow } from "../../types";

export interface WindowFilterProps {
  value: AnalyticsWindow;
  onChange: (window: AnalyticsWindow) => void;
}

/**
 * Segmented 7/30/90-day control, scoped ONLY to the Trends section head
 * (Window Filter requirement). Native radios for a11y; visual box is 28px,
 * hit target grows to 40px via the AGENTS.md `-m-1.5 p-1.5` pattern.
 */
export function WindowFilter({ value, onChange }: WindowFilterProps) {
  const { t } = useTranslation("dashboard");

  return (
    <fieldset
      className="flex items-center gap-0.5"
      aria-label={t("analytics.window.groupLabel")}
    >
      {ANALYTICS_WINDOWS.map((days) => {
        const inputId = `analytics-window-${days}`;
        const checked = value === days;
        return (
          <span key={days} className="-m-1.5 p-1.5">
            <label
              htmlFor={inputId}
              className={cn(
                "flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-full px-2 font-mono text-xs tabular-nums transition-colors duration-100",
                checked
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t("analytics.window.optionLabel", { days })}
            </label>
            <input
              id={inputId}
              type="radio"
              name="analytics-window"
              className="sr-only"
              value={days}
              checked={checked}
              onChange={() => onChange(days)}
            />
          </span>
        );
      })}
    </fieldset>
  );
}
