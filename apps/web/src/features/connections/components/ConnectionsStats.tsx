import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { StatCard } from "@/shared/ui/stat-card";
import { Database, Activity, Layers, Server } from "lucide-react";
import type { Connection } from "../types";
import { useTranslation } from "react-i18next";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";

interface ConnectionsStatsProps {
  connections: Connection[];
  loading?: boolean;
}

export function ConnectionsStats({
  connections,
  loading = false,
}: ConnectionsStatsProps) {
  const { t } = useTranslation('connections')
  const total = connections.length;
  const active = connections.filter((c) => c.isActive).length;

  const byEnv: Record<string, number> = {};
  connections.forEach((c) => {
    byEnv[c.environment] = (byEnv[c.environment] ?? 0) + 1;
  });
  const topEnv = Object.entries(byEnv).sort((a, b) => b[1] - a[1])[0];

  const byType: Record<string, number> = {};
  connections.forEach((c) => {
    byType[c.dbType] = (byType[c.dbType] ?? 0) + 1;
  });
  const postgres = byType["postgres"] ?? 0;
  const mysql = byType["mysql"] ?? 0;

  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StaggerItem>
        <StatCard
          label={t('stats.total')}
          value={total}
          icon={<Database className="h-4 w-4" />}
          loading={loading}
          variant="outlined"
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label={t('stats.active')}
          value={active}
          icon={<Activity className="h-4 w-4" />}
          loading={loading}
          variant="outlined"
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label={t('stats.byEnvironment')}
          value={
            topEnv ? (
              <span className="flex items-baseline gap-1">
                {topEnv[1]}
                <span className="text-sm font-normal text-muted-foreground">
                  {topEnv[0]}
                </span>
              </span>
            ) : total > 0 ? (
              "-"
            ) : (
              "N/A"
            )
          }
          icon={<Layers className="h-4 w-4" />}
          loading={loading}
          variant="outlined"
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label={t('stats.byType')}
          value={
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <img src={postgresSvg} alt="PostgreSQL" className="h-5 w-5 shrink-0" />
                {postgres}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <img src={mysqlSvg} alt="MySQL" className="h-5 w-5 shrink-0" />
                {mysql}
              </span>
            </span>
          }
          icon={<Server className="h-4 w-4" />}
          loading={loading}
          variant="outlined"
        />
      </StaggerItem>
    </Stagger>
  );
}
