import { useState, useMemo } from "react";
import { HardDrive, Database, Radio, Clock, SlidersHorizontal } from "lucide-react";
import { formatDateTimeShort as formatDate } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { StatCard } from "@/shared/ui/stat-card";
import { Card, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Badge } from "@/shared/ui/badge";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { useStorageOverview } from "../hooks/useMaintenance";
import { useConnections } from "@/features/connections/hooks/useConnections";
import { RetentionDialog } from "./RetentionDialog";

function countOldDumps(connections: { oldest: string | null }[]): number {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return connections.filter((c) => {
    if (!c.oldest) return false;
    return new Date(c.oldest) < thirtyDaysAgo;
  }).length;
}

interface ConnectionRowData {
  slug: string;
  name: string;
  environment?: string;
  count: number;
  sizeMb: number;
  oldest: string | null;
}

export function StoragePanel() {
  const { t } = useTranslation("cleanup");
  const { data, isLoading, isError, error } = useStorageOverview();
  const { data: connections = [] } = useConnections();

  const [selectedConnection, setSelectedConnection] = useState<{
    slug: string;
    name: string;
    environment?: string;
  } | null>(null);

  // Only production databases participate in automated retention and cleanup
  const connectionRows: ConnectionRowData[] = useMemo(() => {
    const prodConnections = connections.filter((c) => c.environment === "prod");
    const usageMap = new Map(
      data?.byConnection.map((c) => [c.connectionSlug, c]) ?? [],
    );

    // If we have registered connections, show only production connections
    if (prodConnections.length > 0) {
      return prodConnections.map((conn) => {
        const usage = usageMap.get(conn.slug);
        return {
          slug: conn.slug,
          name: conn.name,
          environment: conn.environment,
          count: usage?.count ?? 0,
          sizeMb: usage?.sizeMb ?? 0,
          oldest: usage?.oldest ?? null,
        };
      });
    }

    // If connections loaded and none are prod, return empty
    if (connections.length > 0 && prodConnections.length === 0) {
      return [];
    }

    // Fallback to overview data only if connections list is still loading
    return (
      data?.byConnection.map((c) => ({
        slug: c.connectionSlug,
        name: c.connectionName,
        count: c.count,
        sizeMb: c.sizeMb,
        oldest: c.oldest,
      })) ?? []
    );
  }, [connections, data]);

  const connectionsWithDumps = connectionRows.filter((c) => c.count > 0).length;
  const oldDumps = countOldDumps(connectionRows);

  return (
    <div className="space-y-6">
      {isError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {t("error.loadStorage", {
            message:
              error instanceof Error
                ? error.message
                : t("error.generic", { ns: "common" }),
          })}
        </div>
      )}

      {/* ── KPI Stat Cards ── */}
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <StatCard
            variant="outlined"
            label={t("stats.totalDumps")}
            value={data?.totalDumps ?? (isLoading ? "-" : 0)}
            icon={<Database className="h-4 w-4" />}
            loading={isLoading}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            variant="outlined"
            label={t("stats.totalMb")}
            value={data != null ? `${data.totalSizeMb.toLocaleString()} MB` : (isLoading ? "-" : "0 MB")}
            icon={<HardDrive className="h-4 w-4" />}
            loading={isLoading}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            variant="outlined"
            label={t("stats.connectionsWithDumps")}
            value={data != null ? `${connectionsWithDumps} / ${connectionRows.length || 1}` : (isLoading ? "-" : 0)}
            icon={<Radio className="h-4 w-4" />}
            loading={isLoading}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            variant="outlined"
            label={t("stats.oldDumps")}
            value={data != null ? oldDumps : (isLoading ? "-" : 0)}
            icon={<Clock className="h-4 w-4" />}
            loading={isLoading}
          />
        </StaggerItem>
      </Stagger>

      {/* ── Storage & Retention Matrix ── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t("detail.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("detail.subtitle")}
            </p>
          </div>
        </div>

        {connectionRows.length === 0 && !isLoading ? (
          <Card variant="outlined" className="p-4">
            <EmptyState
              icon={<HardDrive className="size-6 text-muted-foreground/60" />}
              title={
                connections.length > 0
                  ? t("retention.noProdConnectionsTitle")
                  : t("empty.title")
              }
              description={
                connections.length > 0
                  ? t("retention.noProdConnections")
                  : t("empty.noDumps")
              }
              className="py-8"
            />
          </Card>
        ) : (
          <Card variant="outlined" className="overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    {t("table.caption")}
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-muted/25 text-left text-xs font-medium text-muted-foreground">
                      <th className="px-5 py-3" scope="col">
                        {t("table.connection")}
                      </th>
                      <th className="px-5 py-3 text-right" scope="col">
                        {t("table.dumps")}
                      </th>
                      <th className="px-5 py-3 text-right" scope="col">
                        {t("table.size")}
                      </th>
                      <th className="px-5 py-3 text-right" scope="col">
                        {t("table.oldest")}
                      </th>
                      <th className="px-5 py-3 text-right" scope="col">
                        <span className="sr-only">{t("table.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {connectionRows.map((conn) => (
                      <tr
                        key={conn.slug}
                        className="transition-colors duration-150 hover:bg-muted/30"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-text-primary">
                              {conn.name}
                            </span>
                            {conn.environment && (
                              <Badge
                                variant={
                                  conn.environment.toLowerCase() === "prod"
                                    ? "default"
                                    : "secondary"
                                }
                                className="text-[10px] uppercase tracking-wider"
                              >
                                {conn.environment}
                              </Badge>
                            )}
                          </div>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {conn.slug}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-xs font-medium tabular-nums text-text-secondary">
                          {conn.count}
                        </td>
                        <td className="px-5 py-3.5 text-right text-xs font-medium tabular-nums text-text-secondary">
                          {conn.sizeMb.toLocaleString()} MB
                        </td>
                        <td className="px-5 py-3.5 text-right text-xs tabular-nums text-muted-foreground">
                          {conn.oldest ? formatDate(conn.oldest) : "-"}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setSelectedConnection({
                                slug: conn.slug,
                                name: conn.name,
                                environment: conn.environment,
                              })
                            }
                            className="h-8 gap-1.5 text-xs active:scale-[0.98] transition-transform duration-150 ease-out"
                          >
                            <SlidersHorizontal className="size-3 text-muted-foreground" aria-hidden="true" />
                            {t("retention.configure")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Retention Policy & Pruning Dialog */}
      <RetentionDialog
        connection={selectedConnection}
        open={selectedConnection !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedConnection(null);
        }}
      />
    </div>
  );
}
