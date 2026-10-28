import type { ReactNode } from "react";
import { KpiCard } from "./KpiCard";
import { KpiComparisonRow, type Comparison } from "./KpiDelta";
import { KpiRetry } from "./KpiRetry";
import type { DataStatus } from "./SeriesKpi";

interface ComparisonKpiProps {
  label: string;
  icon: ReactNode;
  accent: string;
  /** The headline figure, already formatted. */
  value: string;
  /** The line under it. */
  caption: string;
  valueStatus: DataStatus;
  /** How the figure moved against its longer reference window. */
  comparison: Comparison;
  onRetry: () => void;
}

/**
 * A KPI whose series is already drawn by a chart below, so it carries no
 * sparkline: its figure, and how that figure moved against the 90 day reference.
 */
export function ComparisonKpi({
  label,
  icon,
  accent,
  value,
  caption,
  valueStatus,
  comparison,
  onRetry,
}: ComparisonKpiProps) {
  if (valueStatus === "error") {
    return (
      <KpiCard
        accent={accent}
        caption={<KpiRetry onRetry={onRetry} />}
        icon={icon}
        label={label}
        value="—"
      />
    );
  }

  return (
    <KpiCard
      accent={accent}
      caption={caption}
      icon={icon}
      label={label}
      loading={valueStatus === "loading"}
      value={value}
      visual={<KpiComparisonRow comparison={comparison} />}
    />
  );
}
