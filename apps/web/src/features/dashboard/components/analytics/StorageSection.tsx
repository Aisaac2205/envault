import { useTranslation } from "react-i18next";
import { formatBytes, formatNumber } from "@/lib/format";
import { Section, type SectionStatus } from "../Section";
import type { ConnectionStorage } from "../../types";

export interface StorageSectionProps {
  rows: ConnectionStorage[];
  status: SectionStatus;
  onRetry?: () => void;
  /** Bytes across every object in the live R2 bucket (from `useStorageStats`). Omit to hide the live figure. */
  liveTotalBytes?: number;
  liveObjectCount?: number;
}

function StorageSkeleton() {
  return (
    <div data-testid="storage-skeleton" className="flex flex-col gap-2.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded-full bg-hairline" />
      ))}
    </div>
  );
}

/**
 * Storage by connection: lifetime volume per connection as ranked HTML bars
 * (Storage by Connection Chart requirement), plus the live R2 figure in the
 * head area (design: "R2-live figure ... from useStorageStats"). Self-wraps
 * in a Section so it fails/retries independently of Trends and Restores.
 */
export function StorageSection({ rows, status, onRetry, liveTotalBytes, liveObjectCount }: StorageSectionProps) {
  const { t } = useTranslation("dashboard");

  const sorted = [...rows].sort((a, b) => b.totalSizeMb - a.totalSizeMb);
  const maxSizeMb = sorted[0]?.totalSizeMb ?? 0;

  return (
    <Section
      id="storage"
      title={t("section.storage")}
      meta={<span>{t("section.allTime")}</span>}
      status={status}
      skeleton={<StorageSkeleton />}
      empty={<p className="text-sm text-muted-foreground">{t("state.empty")}</p>}
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-3">
        {liveTotalBytes !== undefined && liveObjectCount !== undefined && (
          <p className="text-xs text-muted-foreground">
            {t("storage.live", { size: formatBytes(liveTotalBytes), count: liveObjectCount })}
          </p>
        )}
        <ol className="flex flex-col gap-2.5">
          {sorted.map((row) => {
            const label = row.connectionName ?? t("storage.deleted");
            const widthPercent = maxSizeMb > 0 ? (row.totalSizeMb / maxSizeMb) * 100 : 0;
            return (
              <li key={row.connectionId} className="flex items-center gap-3">
                <span
                  data-testid="storage-row-name"
                  className="w-24 shrink-0 truncate text-xs text-text-primary sm:w-32"
                  title={label}
                >
                  {label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-hairline">
                  <div
                    className="h-full rounded-full bg-chart-1 transition-[width] duration-150 motion-reduce:transition-none"
                    style={{ width: `${widthPercent}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {formatNumber(Math.round(row.totalSizeMb))} MB
                </span>
              </li>
            );
          })}
        </ol>
        <p className="text-[11px] text-muted-foreground/70">{t("storage.note")}</p>
      </div>
    </Section>
  );
}
