import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { StatusLine } from "./StatusLine";
import type { DashboardHeadline } from "../lib/derive-headline";

export interface DashboardHeaderProps {
  headline: DashboardHeadline;
  /** Max `dataUpdatedAt` (ms) across every mounted dashboard query, or null before the first fetch resolves. */
  updatedAt: number | null;
}

function formatClockTime(ms: number): string {
  const locale = i18n.language?.startsWith("en") ? "en-US" : "es-AR";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/**
 * Page header: title + a static "Updated HH:MM:SS" freshness label (no
 * animated refresh indicator — dashboard-page-shell "Freshness Timestamp")
 * and the derived status line.
 */
export function DashboardHeader({ headline, updatedAt }: DashboardHeaderProps) {
  const { t } = useTranslation("dashboard");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-bold text-text-primary">{t("header.title")}</h1>
        {updatedAt !== null && (
          <span className="font-mono text-xs tracking-tight tabular-nums text-muted-foreground">
            {t("header.updatedAt", { time: formatClockTime(updatedAt) })}
          </span>
        )}
      </div>
      <StatusLine headline={headline} />
    </div>
  );
}
