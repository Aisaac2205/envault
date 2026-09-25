import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { DataTable, type Column } from "@/shared/ui/data-table";
import type { R2Object } from "../types";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/lib/format";
import { formatSize } from "@/shared/lib/format";
import cloudflareSvg from "@/shared/assets/Cloudflare.svg";
import { Activity } from "lucide-react";

interface SystemHealthCardProps {
  dumps: R2Object[];
}

interface StorageMetricItem {
  id: string;
  name: string;
  subtext: string;
  value: string;
}

export function SystemHealthCard({ dumps }: SystemHealthCardProps) {
  const { t } = useTranslation('dashboard');
  const totalSize = dumps.reduce((acc, d) => acc + d.size, 0);
  const lastDump =
    dumps.length > 0
      ? dumps.reduce((latest, d) =>
          new Date(d.lastModified) > new Date(latest.lastModified) ? d : latest,
        )
      : null;

  const hasStorage = dumps.length > 0;

  if (!hasStorage) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <CardTitle className="text-base">{t('health.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<Activity className="h-8 w-8" />}
            title={t('health.empty.title')}
            description={t('health.empty.description')}
          />
        </CardContent>
      </Card>
    );
  }

  const metricsData: StorageMetricItem[] = [
    {
      id: "dumps",
      name: t('health.dumpsStored', { defaultValue: 'Dumps almacenados' }),
      subtext: "Cloudflare R2",
      value: `${dumps.length}`,
    },
    {
      id: "space",
      name: t('health.spaceUsed', { defaultValue: 'Espacio ocupado' }),
      subtext: t('health.totalStorage', { defaultValue: 'Volumen total' }),
      value: totalSize > 0 ? formatSize(totalSize) : "0 MB",
    },
    {
      id: "sync",
      name: t('health.lastDump', { defaultValue: 'Último dump' }),
      subtext: t('health.latestActivity', { defaultValue: 'Actividad reciente' }),
      value: lastDump ? formatRelativeTime(lastDump.lastModified) : "N/A",
    },
  ];

  const columns: Column<StorageMetricItem>[] = [
    {
      header: (
        <span className="inline-flex items-center gap-1.5">
          {t('health.storage')}
          <img src={cloudflareSvg} alt="Cloudflare" className="h-3.5 w-3.5" />
        </span>
      ),
      accessor: (m) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-text-primary">{m.name}</span>
          <span className="text-[11px] text-muted-foreground">{m.subtext}</span>
        </div>
      ),
    },
    {
      header: t('column.status', { defaultValue: 'Estado / Valor' }),
      accessor: (m) => (
        <span className="text-xs font-semibold tabular-nums text-text-primary">
          {m.value}
        </span>
      ),
      className: "text-right w-32",
      headerClassName: "text-right",
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{t('health.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        <DataTable columns={columns} data={metricsData} compact />
      </CardContent>
    </Card>
  );
}
