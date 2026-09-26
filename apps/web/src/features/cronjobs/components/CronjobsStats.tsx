import { StatCard } from "@/shared/ui/stat-card";
import { Stagger, StaggerItem } from "@/shared/ui/motion/Stagger";
import { Clock, Play, CheckCircle2, Calendar } from "lucide-react";
import type { Cronjob } from "../types";
import { useTranslation } from "react-i18next";
import { nextRunParts } from "@/lib/format";

function ValueWithUnit({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="flex items-baseline gap-1">
      {value}
      {unit && (
        <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      )}
    </span>
  );
}

interface CronjobsStatsProps {
  cronjobs: Cronjob[];
  loading?: boolean;
}

export function CronjobsStats({
  cronjobs,
  loading = false,
}: CronjobsStatsProps) {
  const { t } = useTranslation('cronjobs')
  const total = cronjobs.length;
  const active = cronjobs.filter((c) => c.isActive).length;

  const byStatus: Record<string, number> = {};
  cronjobs.forEach((c) => {
    if (c.lastStatus) {
      byStatus[c.lastStatus] = (byStatus[c.lastStatus] ?? 0) + 1;
    }
  });
  const topStatus = Object.entries(byStatus).sort(
    (a, b) => b[1] - a[1],
  )[0];

  const nextRunTimes = cronjobs
    .filter((c) => c.nextRunAt)
    .map((c) => new Date(c.nextRunAt!).getTime())
    .sort((a, b) => a - b);
  const nextRun = nextRunParts(
    nextRunTimes.length > 0
      ? new Date(nextRunTimes[0]).toISOString()
      : null,
  );

  const STATUS_LABELS: Record<string, string> = {
    pending: t('status.pending'),
    running: t('status.running'),
    completed: t('status.completed'),
    failed: t('status.failed'),
  };

  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StaggerItem>
        <StatCard
          variant="outlined"
          label={t('stats.total')}
          value={total}
          icon={<Clock className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          variant="outlined"
          label={t('stats.active')}
          value={active}
          icon={<Play className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          variant="outlined"
          label={t('stats.topStatus')}
          value={
            topStatus ? (
              <ValueWithUnit
                value={String(topStatus[1])}
                unit={STATUS_LABELS[topStatus[0]] ?? topStatus[0]}
              />
            ) : total > 0 ? (
              "-"
            ) : (
              "N/A"
            )
          }
          icon={<CheckCircle2 className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          variant="outlined"
          label={t('stats.nextRun')}
          value={<ValueWithUnit value={nextRun.value} unit={nextRun.unit} />}
          icon={<Calendar className="h-4 w-4" />}
          loading={loading}
        />
      </StaggerItem>
    </Stagger>
  );
}
