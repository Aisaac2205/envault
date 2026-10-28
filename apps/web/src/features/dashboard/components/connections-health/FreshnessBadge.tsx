import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import type { Freshness } from "../../types";
import { FRESHNESS_META } from "./freshness-meta";

interface FreshnessBadgeProps {
  freshness: Freshness;
  className?: string;
}

/** How fresh a connection's backups are: an icon, a label and the status color. */
export function FreshnessBadge({ freshness, className }: FreshnessBadgeProps) {
  const { t } = useTranslation("dashboard");
  const { icon: Icon, labelKey, tone } = FRESHNESS_META[freshness];

  return (
    <Badge className={cn("gap-1.5 font-medium text-text-primary", tone, className)} variant="outline">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {t(labelKey)}
    </Badge>
  );
}
