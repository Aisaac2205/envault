import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/ui/skeleton";
import type { Change, Trend } from "./kpi-data";

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const satisfies Record<Trend, unknown>;

interface KpiDeltaProps {
  change: Change;
  /** The signed figure as it reads: `+1.2 pts`, `+24%`, `-7`. */
  text: string;
  /** What it is compared with: `vs 90d: 96.2%`. */
  reference: string;
}

/**
 * How a figure moved against its reference. The arrow, the sign and a word for
 * assistive technology all say the direction, so the color of the chip (the
 * card's accent, never a status color) is not what carries it. Inline, so it can
 * sit in a caption.
 */
export function KpiDelta({ change, text, reference }: KpiDeltaProps) {
  const { t } = useTranslation("dashboard");
  const Icon = TREND_ICON[change.trend];

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--kpi-accent)_16%,transparent)] px-1.5 py-0.5 text-xs font-semibold tabular-nums text-text-primary">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only">{t(`kpi.delta.${change.trend}`)}: </span>
        {text}
      </span>
      <span className="text-xs tabular-nums text-text-secondary">{reference}</span>
    </span>
  );
}

/** Where the comparison of a card without a sparkline stands. */
export type Comparison =
  | { status: "loading" }
  /** There is nothing to compare with: no baseline yet, or it could not be loaded. */
  | { status: "none" }
  | { status: "ready"; change: Change; text: string; reference: string };

/** The bottom row of a card without a sparkline: the comparison, in the place a plot takes elsewhere. */
export function KpiComparisonRow({ comparison }: { comparison: Comparison }) {
  const { t } = useTranslation("dashboard");

  return (
    <div className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 self-end border-t border-dashed border-border pt-3">
      {comparison.status === "loading" ? (
        <Skeleton className="h-6 w-40 motion-reduce:animate-none" data-testid="kpi-delta-skeleton" />
      ) : comparison.status === "none" ? (
        <span className="text-xs text-text-secondary">{t("kpi.delta.none")}</span>
      ) : (
        <KpiDelta change={comparison.change} reference={comparison.reference} text={comparison.text} />
      )}
    </div>
  );
}
