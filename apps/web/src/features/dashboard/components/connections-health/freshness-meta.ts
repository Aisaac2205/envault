import { CircleCheck, CircleDashed, Clock, OctagonAlert, type LucideIcon } from "lucide-react";
import type { Freshness } from "../../types";

interface FreshnessMeta {
  /** A different shape per state, so the badge never relies on its color alone. */
  icon: LucideIcon;
  labelKey: `health.freshness.${Freshness}`;
  /** Tailwind classes for the icon color, the tinted surface and the border. */
  tone: string;
  /** A faint wash for the whole row, so the states that need a look stand out in a long table. */
  rowTone: string;
}

/**
 * Freshness is a job-state signal, so it uses the status tokens (ok, warning,
 * error) with an icon and a label. The text stays in the text token: only the
 * icon, the surface and the border carry the color.
 */
export const FRESHNESS_META: Record<Freshness, FreshnessMeta> = {
  ok: {
    icon: CircleCheck,
    labelKey: "health.freshness.ok",
    tone: "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_13%,transparent)] [&>svg]:text-success",
    rowTone: "",
  },
  late: {
    icon: Clock,
    labelKey: "health.freshness.late",
    tone: "border-[color-mix(in_oklab,var(--color-warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)] [&>svg]:text-warning",
    rowTone: "bg-[color-mix(in_oklab,var(--color-warning)_5%,transparent)]",
  },
  stale: {
    icon: OctagonAlert,
    labelKey: "health.freshness.stale",
    tone: "border-[color-mix(in_oklab,var(--color-error)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-error)_13%,transparent)] [&>svg]:text-error",
    rowTone: "bg-[color-mix(in_oklab,var(--color-error)_6%,transparent)]",
  },
  unknown: {
    icon: CircleDashed,
    labelKey: "health.freshness.unknown",
    tone: "border-border bg-muted/60 [&>svg]:text-text-secondary",
    rowTone: "",
  },
};
