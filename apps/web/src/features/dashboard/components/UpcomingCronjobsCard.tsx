import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/empty-state";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatUpcomingTime } from "@/lib/format";
import type { CronjobEntity } from "../types";

interface UpcomingCronjobsCardProps {
  cronjobs: CronjobEntity[];
}

export function UpcomingCronjobsCard({ cronjobs }: UpcomingCronjobsCardProps) {
  const { t } = useTranslation('dashboard');
  const active = cronjobs.filter((c) => c.isActive);
  const paused = cronjobs.filter((c) => !c.isActive);

  // Order by nextRunAt ascending; nulls go last.
  const sortedActive = [...active].sort((a, b) => {
    if (!a.nextRunAt) return 1;
    if (!b.nextRunAt) return -1;
    return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime();
  });

  const visible = sortedActive.slice(0, 3);
  const remaining = sortedActive.length - visible.length;

  const columns: Column<CronjobEntity>[] = [
    {
      header: t('column.cronjob', { defaultValue: 'Cronjob' }),
      accessor: (cj) => (
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-medium text-xs text-text-primary" title={cj.name}>
            {cj.name}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">
            {cj.connectionName ?? cj.cronExpression}
          </span>
        </div>
      ),
    },
    {
      header: t('column.nextRun', { defaultValue: 'Próxima ejecución' }),
      accessor: (cj) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums font-medium">
          {cj.nextRunAt ? formatUpcomingTime(cj.nextRunAt) : t('upcoming.noNext')}
        </span>
      ),
      className: "w-28 text-right",
      headerClassName: "text-right",
    },
  ];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="text-base">{t('upcoming.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-8 w-8" />}
            title={t('upcoming.empty')}
            description={t('upcoming.emptyDescription')}
          />
        ) : (
          <>
            <DataTable columns={columns} data={visible} compact />
            {(remaining > 0 || paused.length > 0) && (
              <div className="py-2.5 text-center text-xs text-muted-foreground space-y-0.5">
                {remaining > 0 && (
                  <p>{t("upcoming.more", { count: remaining })}</p>
                )}
                {paused.length > 0 && (
                  <p className="text-muted-foreground/70">
                    {t(paused.length === 1 ? 'upcoming.paused_one' : 'upcoming.paused_other', { count: paused.length })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
