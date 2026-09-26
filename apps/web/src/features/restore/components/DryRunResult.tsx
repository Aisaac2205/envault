import type { DryRunResult as DryRunResultType, DryRunConnectionInfo } from "../types";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { formatNumber } from "@/lib/format";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";
import { Check, X } from "lucide-react";
import { useState } from "react";

const DB_LOGOS: Record<string, string> = {
  postgres: postgresSvg as string,
  mysql: mysqlSvg as string,
};

const DB_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

function ConnectionCard({ conn, label }: { conn: DryRunConnectionInfo; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2">
      {DB_LOGOS[conn.dbType] && (
        <img
          src={DB_LOGOS[conn.dbType]}
          alt={DB_LABELS[conn.dbType] ?? conn.dbType}
          className="h-5 w-5 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold" title={conn.name}>{conn.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground" title={conn.database}>{conn.database}</p>
      </div>
      <Badge variant="outline" className="shrink-0 rounded-full text-[10px] uppercase">
        {conn.environment}
      </Badge>
    </div>
  );
}

interface DryRunResultProps {
  result: DryRunResultType;
  onConfirm: (excludedTables: string[]) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function DryRunResult({
  result,
  onConfirm,
  onCancel,
  isLoading,
}: DryRunResultProps) {
  const { t } = useTranslation("restore");
  const { source, target, diff } = result;
  const [excludedTables, setExcludedTables] = useState<Set<string>>(new Set());

  function toggleTable(name: string) {
    setExcludedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!diff || !source) {
    return <TargetOnlyView target={target} targetConnection={result.targetConnection} onConfirm={() => onConfirm([])} onCancel={onCancel} isLoading={isLoading} />;
  }

  return (
    <div className="space-y-4">
      {/* Connection info */}
      <div className="grid gap-3 sm:grid-cols-2">
        {result.sourceConnection && (
          <ConnectionCard conn={result.sourceConnection} label={t("dryRun.sourceLabel")} />
        )}
        <ConnectionCard conn={result.targetConnection} label={t("dryRun.targetLabel")} />
      </div>

      <div className="flex gap-4 text-sm">
        <div className="flex-1 rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dryRun.sourceLabel")}</p>
          <p className="font-mono font-semibold">
            {t("dryRun.sourceSummary", { tables: source.tableCount, rows: formatNumber(source.estimatedRows) })}
          </p>
        </div>
        <div className="flex-1 rounded-lg bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dryRun.targetLabel")}</p>
          <p className="font-mono font-semibold">
            {t("dryRun.targetSummary", { tables: target.tableCount, rows: formatNumber(target.estimatedRows) })}
          </p>
        </div>
      </div>

      <div className="max-h-[60dvh] overflow-auto rounded-xl bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
            <tr>
              <th className="w-10 px-3 py-2.5"></th>
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("dryRun.columnTable")}
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {result.sourceConnection?.environment?.toUpperCase() ?? t("dryRun.sourceLabel")}
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {result.targetConnection.environment.toUpperCase()}
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("dryRun.columnDiff")}
              </th>
            </tr>
          </thead>
          <tbody>
            {diff.added.map((name) => (
              <tr key={name} className="border-t border-border/20 bg-emerald-500/5">
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleTable(name)}
                    className="flex h-5 w-5 items-center justify-center rounded border border-border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={t("dryRun.excludeAria", { name })}
                  >
                    {excludedTables.has(name) ? (
                      <X className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Check className="h-3 w-3 text-transparent" />
                    )}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <span className="mr-1.5 text-xs text-emerald-600">+</span>{name}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {formatNumber(source.tables.find((row) => row.name === name)?.estimatedRows ?? 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">-</td>
                <td className="px-3 py-2.5 text-right text-xs text-emerald-600">{t("dryRun.statusNew")}</td>
              </tr>
            ))}
            {diff.common.map((row) => {
              const delta = row.sourceRows - row.targetRows;
              const isExcluded = excludedTables.has(row.name);
              return (
                <tr key={row.name} className={`border-t border-border/20 hover:bg-muted/40 ${isExcluded ? "opacity-40" : ""}`}>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleTable(row.name)}
                      className="flex h-5 w-5 items-center justify-center rounded border border-border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={t("dryRun.excludeAria", { name: row.name })}
                    >
                      {isExcluded ? (
                        <X className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Check className="h-3 w-3 text-transparent" />
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">{row.name}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {formatNumber(row.sourceRows)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {formatNumber(row.targetRows)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                    {delta > 0 ? `+${formatNumber(delta)}` : delta < 0 ? formatNumber(delta) : "="}
                  </td>
                </tr>
              );
            })}
            {diff.removed.map((name) => (
              <tr key={name} className="border-t border-border/20 bg-red-500/5">
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggleTable(name)}
                    className="flex h-5 w-5 items-center justify-center rounded border border-border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={t("dryRun.excludeAria", { name })}
                  >
                    {excludedTables.has(name) ? (
                      <X className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Check className="h-3 w-3 text-transparent" />
                    )}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <span className="mr-1.5 text-xs text-red-500">−</span>{name}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">-</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {formatNumber(target.tables.find((t) => t.name === name)?.estimatedRows ?? 0)}
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-red-500">{t("dryRun.statusDrop")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-muted-foreground">
          {excludedTables.size > 0
            ? t("dryRun.excludedCount", { count: excludedTables.size })
            : t("dryRun.allTables")}
        </span>
        <div className="flex gap-3">
          <Button onClick={onCancel} disabled={isLoading} variant="ghost" size="sm">
            {t("cancel")}
          </Button>
          <Button onClick={() => onConfirm(Array.from(excludedTables))} disabled={isLoading} size="sm">
            {isLoading ? t("action.processing") : t("action.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TargetOnlyView({
  target,
  targetConnection,
  onConfirm,
  onCancel,
  isLoading,
}: {
  target: DryRunResultType["target"];
  targetConnection: DryRunResultType["targetConnection"];
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation("restore");

  return (
    <div className="space-y-4">
      <ConnectionCard conn={targetConnection} label={t("dryRun.targetLabel")} />

      <p className="text-sm">
        <span className="text-xs text-amber-600">({t("dryRun.noManifest")})</span>{" "}
        {t("dryRun.currentTarget")}:{" "}
        <span className="font-mono font-semibold">
          {t("dryRun.targetSummary", { tables: target.tableCount, rows: formatNumber(target.estimatedRows) })}
        </span>
      </p>

      <div className="max-h-[60dvh] overflow-auto rounded-xl bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("dryRun.columnTable")}
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("dryRun.estimatedRows")}
              </th>
            </tr>
          </thead>
          <tbody>
            {target.tables.map((table) => (
              <tr key={table.name} className="border-t border-border/20 hover:bg-muted/40">
                <td className="px-3 py-2.5">{table.name}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {formatNumber(table.estimatedRows)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3 pt-2 justify-end">
        <Button onClick={onCancel} disabled={isLoading} variant="ghost" size="sm">
          {t("cancel")}
        </Button>
        <Button onClick={onConfirm} disabled={isLoading} size="sm">
          {isLoading ? t("action.processing") : t("action.confirm")}
        </Button>
      </div>
    </div>
  );
}
