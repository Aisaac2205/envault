import { Check, Database } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EnrichedR2Object } from "@/features/dumps/types";
import { cn } from "@/shared/lib/cn";
import { formatSize } from "@/shared/lib/format";
import { formatDateTimeShort as formatDate } from "@/lib/format";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";

const DB_LOGOS: Record<string, string> = {
  postgres: postgresSvg as string,
  mysql: mysqlSvg as string,
};

const DB_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

interface DumpsListProps {
  dumps: EnrichedR2Object[];
  value: EnrichedR2Object | null;
  onChange: (dump: EnrichedR2Object) => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
}

export function DumpsList({
  dumps,
  value,
  onChange,
  disabled = false,
  label,
}: DumpsListProps) {
  const { t } = useTranslation("restore");
  const resolvedLabel = label ?? t("dumps.available");

  if (dumps.length === 0) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3.5 py-4 text-xs text-muted-foreground"
      >
        <Database className="size-4 shrink-0 text-muted-foreground/60" />
        <span>{t("dumps.empty")}</span>
      </div>
    );
  }

  return (
    <ul
      aria-label={resolvedLabel}
      className="flex max-h-72 flex-col gap-1 overflow-auto rounded-xl bg-muted/20 p-1"
    >
      {dumps.map((dump) => {
        const isSelected = value?.key === dump.key;
        const logo = dump.dbType ? DB_LOGOS[dump.dbType] : undefined;
        const dbLabel = dump.dbType
          ? DB_LABELS[dump.dbType] ?? dump.dbType
          : "DB";
        return (
          <li key={dump.key}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={`Volcado ${dbLabel} ${dump.timestamp} (${formatSize(dump.size)})`}
              disabled={disabled}
              onClick={() => onChange(dump)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  isSelected ? "opacity-100" : "opacity-0",
                )}
              />
              {logo && (
                <img
                  src={logo}
                  alt={dbLabel}
                  className="size-4 shrink-0"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium">
                  {dump.timestamp}
                </span>
                <span
                  className={cn(
                    "truncate text-[11px]",
                    isSelected
                      ? "text-accent-foreground/75"
                      : "text-foreground/55",
                  )}
                >
                  {formatDate(dump.lastModified)}
                </span>
              </div>
              <span
                className={cn(
                  "ml-auto w-20 shrink-0 text-right text-xs",
                  isSelected
                    ? "text-accent-foreground/75"
                    : "text-foreground/55",
                )}
              >
                {formatSize(dump.size)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
