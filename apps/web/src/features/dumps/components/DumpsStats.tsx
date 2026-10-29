import { StatCard } from "@/shared/ui/stat-card";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { Database, HardDrive, Calendar, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import type { BackupJob } from "../types";
import { formatSizeMb } from "@/shared/lib/format";

interface DumpsStatsProps {
  dumps: BackupJob[];
}

export function DumpsStats({ dumps }: DumpsStatsProps) {
  const { t } = useTranslation('dumps')
  const completed = dumps.filter((d) => d.status === "completed");
  const totalSize = completed.reduce(
    (acc, d) => acc + (d.fileSizeMb ?? 0),
    0,
  );
  const lastBackup =
    completed.length > 0
      ? completed.reduce((latest, d) =>
          new Date(d.completedAt!) > new Date(latest.completedAt!) ? d : latest,
        )
      : null;

  const connCounts: Record<string, number> = {};
  completed.forEach((d) => {
    connCounts[d.connectionName] = (connCounts[d.connectionName] ?? 0) + 1;
  });
  const topConn = Object.entries(connCounts).sort(
    (a, b) => b[1] - a[1],
  )[0];

  const lastBackupLabel = lastBackup?.completedAt
    ? formatDate(lastBackup.completedAt, { day: '2-digit', month: 'short' })
    : "N/A";

  return (
    <Stagger className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t('label.totalBackups')}
          value={dumps.length}
          icon={<Database className="h-4 w-4" />}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t('label.totalSpace')}
          value={formatSizeMb(totalSize)}
          icon={<HardDrive className="h-4 w-4" />}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t('label.lastBackup')}
          value={lastBackupLabel}
          icon={<Calendar className="h-4 w-4" />}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          variant="outlined"
          label={t('label.mostBacked')}
          value={topConn?.[0] ?? "N/A"}
          truncate
          icon={<Server className="h-4 w-4" />}
        />
      </StaggerItem>
    </Stagger>
  );
}
