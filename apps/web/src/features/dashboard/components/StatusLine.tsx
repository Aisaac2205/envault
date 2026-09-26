import { CheckCircle2, XCircle, Loader2, CircleDashed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime, formatUpcomingTime } from "@/lib/format";
import type { DashboardHeadline, HeadlineTone } from "../lib/derive-headline";

export interface StatusLineProps {
  headline: DashboardHeadline;
}

const TONE_ICON: Record<HeadlineTone, { Icon: typeof CheckCircle2; className: string }> = {
  ok: { Icon: CheckCircle2, className: "text-success" },
  failed: { Icon: XCircle, className: "text-error" },
  running: { Icon: Loader2, className: "text-chart-running" },
  none: { Icon: CircleDashed, className: "text-muted-foreground" },
};

/**
 * One derived headline sentence (dashboard-page-shell "Derived Status Line").
 * Only the tone text sits inside the `aria-live="polite"` region — it is the
 * only part of this line that doesn't change on every 15s poll (connection
 * name and relative time do), so it announces on tone change only, never on
 * every background refetch.
 */
export function StatusLine({ headline }: StatusLineProps) {
  const { t } = useTranslation("dashboard");
  const { Icon, className } = TONE_ICON[headline.tone];
  const relativeAt = headline.at ? formatRelativeTime(headline.at) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
        <span aria-live="polite" aria-atomic="true" className="font-medium text-text-primary">
          {t(`headline.${headline.tone}`)}
        </span>
        {headline.connectionName && (
          <span className="text-muted-foreground">· {headline.connectionName}</span>
        )}
        {relativeAt && <span className="text-muted-foreground">· {relativeAt}</span>}
      </span>
      {headline.nextRun && (
        <span className="text-muted-foreground">
          {t("headline.nextRun", { time: formatUpcomingTime(headline.nextRun.at) })} · {headline.nextRun.name}
        </span>
      )}
    </div>
  );
}
