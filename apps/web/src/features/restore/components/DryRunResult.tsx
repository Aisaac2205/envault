import type { DryRunResult as DryRunResultType, DryRunConnectionInfo } from "../types";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { formatNumber } from "@/lib/format";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";
import { engineLogoClass } from "@/shared/components/EngineIcon";
import { Check, X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const DB_LOGOS: Record<string, string> = {
  postgres: postgresSvg as string,
  mysql: mysqlSvg as string,
};

const DB_LABELS: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

interface ScrollEdges {
  /** Columns are hidden past the left edge. */
  start: boolean;
  /** Columns are hidden past the right edge. */
  end: boolean;
  /** Width of a classic vertical scrollbar, so the end shadow sits beside it. */
  scrollbarX: number;
  /** Height of a classic horizontal scrollbar, so the edge shadows stop above it. */
  scrollbarY: number;
}

const NO_OVERFLOW: ScrollEdges = { start: false, end: false, scrollbarX: 0, scrollbarY: 0 };

function sameEdges(a: ScrollEdges, b: ScrollEdges) {
  return a.start === b.start && a.end === b.end && a.scrollbarX === b.scrollbarX && a.scrollbarY === b.scrollbarY;
}

/** Tracks which horizontal edges of a scroller still hide content. */
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NO_OVERFLOW);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      const hidden = el.scrollWidth - el.clientWidth;
      // 1 px of slack absorbs fractional scroll offsets on zoomed screens.
      const next: ScrollEdges = {
        start: el.scrollLeft > 1,
        end: hidden - el.scrollLeft > 1,
        scrollbarX: Math.max(0, el.offsetWidth - el.clientWidth),
        scrollbarY: Math.max(0, el.offsetHeight - el.clientHeight),
      };
      setEdges((prev) => (sameEdges(prev, next) ? prev : next));
    }
    el.addEventListener("scroll", measure, { passive: true });
    // The observer reports once on observe(), which covers the first measure.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  return { ref, edges };
}

/**
 * Named, focusable scroll region so keyboard users can scroll a wide table on
 * narrow screens (Roselli, "Under-Engineered Responsive Tables"). A narrow
 * edge shadow shows only while columns are hidden in that direction, so a
 * table that fits looks exactly as before; it stays visible over blank rows
 * and leaves the peeking column readable, which a fade to the card would hide.
 */
function TableScrollRegion({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const { ref, edges } = useScrollEdges<HTMLDivElement>();
  const edgeClass =
    "pointer-events-none absolute top-0 z-20 w-3 from-black/10 to-transparent opacity-0 transition-opacity duration-150 ease-out data-[visible=true]:opacity-100 dark:from-black/50";

  return (
    <div className="relative isolate">
      <div
        ref={ref}
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={0}
        className="max-h-[60dvh] overflow-auto rounded-xl bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        data-scroll-fade="start"
        data-visible={edges.start}
        className={cn(edgeClass, "left-0 rounded-l-xl bg-linear-to-r")}
        style={{ bottom: edges.scrollbarY }}
      />
      <div
        aria-hidden="true"
        data-scroll-fade="end"
        data-visible={edges.end}
        className={cn(edgeClass, "rounded-r-xl bg-linear-to-l")}
        style={{ bottom: edges.scrollbarY, right: edges.scrollbarX }}
      />
    </div>
  );
}

function ConnectionCard({ conn, label }: { conn: DryRunConnectionInfo; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2">
      {DB_LOGOS[conn.dbType] && (
        <img
          src={DB_LOGOS[conn.dbType]}
          alt={DB_LABELS[conn.dbType] ?? conn.dbType}
          className={cn("h-5 w-5 shrink-0", engineLogoClass(conn.dbType))}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {/* Below sm the full names wrap, so the restore target stays readable. */}
        <p className="text-sm font-semibold [overflow-wrap:anywhere] sm:truncate" title={conn.name}>{conn.name}</p>
        <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere] sm:truncate" title={conn.database}>{conn.database}</p>
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
  const captionId = useId();

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {result.sourceConnection && (
          <ConnectionCard conn={result.sourceConnection} label={t("dryRun.sourceLabel")} />
        )}
        <ConnectionCard conn={result.targetConnection} label={t("dryRun.targetLabel")} />
      </div>

      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:gap-4">
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

      <TableScrollRegion labelledBy={captionId}>
        <table className="w-full text-sm">
          <caption id={captionId} className="sr-only">
            {t("dryRun.comparisonRegion")}
          </caption>
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
            <tr>
              <th className="w-10 px-3 py-2.5"></th>
              <th className="min-w-40 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                <td className="px-3 py-2.5 [overflow-wrap:anywhere]">
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
                  <td className="px-3 py-2.5 [overflow-wrap:anywhere]">{row.name}</td>
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
                <td className="px-3 py-2.5 [overflow-wrap:anywhere]">
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
      </TableScrollRegion>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {excludedTables.size > 0
            ? t("dryRun.excludedCount", { count: excludedTables.size })
            : t("dryRun.allTables")}
        </span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
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
  const captionId = useId();

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

      <TableScrollRegion labelledBy={captionId}>
        <table className="w-full text-sm">
          <caption id={captionId} className="sr-only">
            {t("dryRun.currentTarget")}
          </caption>
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
                <td className="px-3 py-2.5 [overflow-wrap:anywhere]">{table.name}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">
                  {formatNumber(table.estimatedRows)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
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
