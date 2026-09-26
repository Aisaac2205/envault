import { StatCard } from "@/shared/ui/stat-card";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { Sparkline } from "@/shared/ui/sparkline";
import {
  CheckCircle,
  XCircle,
  CalendarCheck,
  Database,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DashboardStats, ConnectionEntity, DailyBackupCount } from "../types";

interface KpiGridProps {
  stats: DashboardStats | null;
  connections: ConnectionEntity[];
  dailyCounts: DailyBackupCount[];
}

export function KpiGrid({ stats, connections, dailyCounts }: KpiGridProps) {
  const { t } = useTranslation('dashboard')
  const active = connections.filter((c) => c.isActive).length;

  // Derive last-7-days sparkline data from dailyCounts
  const last7 = dailyCounts.slice(-7);
  const sevenDaySeries = last7.map((d) => d.scheduled + d.manual);
  const sevenDayTotal = sevenDaySeries.reduce((a, b) => a + b, 0);
  const sparklineLabel =
    sevenDaySeries.length >= 2
      ? t('kpi.backupsAria', { series: sevenDaySeries.join(', ') })
      : undefined;

  return (
    <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StaggerItem>
        <StatCard
          label={t('kpi.successRate')}
          value={stats ? `${stats.successRate30d}%` : "-"}
          icon={<CheckCircle className="h-4 w-4" />}
          variant="outlined"
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label={t('kpi.backups7d')}
          value={sevenDayTotal}
          aside={
            sevenDaySeries.length >= 2 ? (
              <Sparkline
                data={sevenDaySeries}
                width={80}
                height={24}
                aria-label={sparklineLabel}
              />
            ) : undefined
          }
          icon={<CalendarCheck className="h-4 w-4" />}
          variant="outlined"
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label={t('kpi.failed7d')}
          value={stats?.failed7d ?? 0}
          icon={<XCircle className="h-4 w-4" />}
          statusColor={
            stats && stats.failed7d > 0 ? "var(--color-error)" : undefined
          }
          variant="outlined"
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label={t('kpi.activeConnections')}
          value={`${active}/${connections.length}`}
          icon={<Database className="h-4 w-4" />}
          variant="outlined"
        />
      </StaggerItem>
    </Stagger>
  );
}
