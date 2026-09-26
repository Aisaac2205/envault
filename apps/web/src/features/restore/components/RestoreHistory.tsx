import { useEffect, useMemo, useState, useRef } from "react";
import { Badge } from "@/shared/ui/badge";
import { StatusBadge } from "@/shared/ui/status-badge";
import { EmptyState } from "@/shared/ui/empty-state";
import { useTranslation } from "react-i18next";
import { formatDateTimeShort } from "@/lib/format";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import {
  Filter,
  ChevronDown,
  Check,
  History as HistoryIcon,
  Ban,
  Loader2,
} from "lucide-react";
import type { RestoreJob, Connection } from "../types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { restoreApi } from "../api/restore-api";

interface RestoreHistoryProps {
  jobs: RestoreJob[];
  connections: Connection[];
}

const STATUS_CONFIG_KEYS: Record<RestoreJob["status"], string> = {
  completed: 'status.completed',
  failed: 'status.failed',
  running: 'status.running',
  pending: 'status.pending',
};


const ENV_FILTERS = ["all", "dev", "qa", "prod"] as const;
const STATUS_FILTERS = ["all", "completed", "failed", "running", "pending"] as const;

function formatDuration(
  startedAt: string,
  completedAt: string | null,
): string {
  if (!completedAt) return "-";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const diffMs = end - start;
  if (diffMs < 1000) return `${diffMs}ms`;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function RestoreHistory({
  jobs,
  connections,
}: RestoreHistoryProps) {
  const { t } = useTranslation('restore')
  const queryClient = useQueryClient();
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [jobToCancel, setJobToCancel] = useState<RestoreJob | null>(null);

  const handleCancelRestore = async () => {
    if (!jobToCancel) return;
    setCancellingJobId(jobToCancel.id);
    try {
      await restoreApi.cancelRestore(jobToCancel.id);
      toast.success(t("toast.cancelled"));
      await queryClient.invalidateQueries({ queryKey: ["restore", "history"] });
      setJobToCancel(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("toast.cancelError");
      toast.error(t("toast.cancelError"), { description: message });
    } finally {
      setCancellingJobId(null);
    }
  };

  const connectionMap = useMemo(() => {
    const map = new Map<string, { name: string; database: string; dbType: string }>();
    for (const c of connections) map.set(c.id, { name: c.name, database: c.database, dbType: c.dbType });
    return map;
  }, [connections]);

  const DB_LOGOS: Record<string, string> = {
    postgres: postgresSvg as string,
    mysql: mysqlSvg as string,
  };
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [envOpen, setEnvOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

  const MAX_HISTORY_ITEMS = 18;

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const envMatch =
        envFilter === "all" || job.targetEnvironment === envFilter;
      const statusMatch =
        statusFilter === "all" || job.status === statusFilter;
      return envMatch && statusMatch;
    });
  }, [jobs, envFilter, statusFilter]);

  const displayedJobs = useMemo(
    () => filteredJobs.slice(0, MAX_HISTORY_ITEMS),
    [filteredJobs],
  );

  // Reset scroll position when filters change
  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollTop = 0;
  }, [envFilter, statusFilter]);

  return (
    <div className="flex min-h-0 h-full flex-col">
      {/* Header with filters */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HistoryIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('history.title')}</h3>
          {filteredJobs.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({displayedJobs.length}
              {filteredJobs.length > MAX_HISTORY_ITEMS
                ? `/${filteredJobs.length}`
                : ""}
              )
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Popover open={envOpen} onOpenChange={setEnvOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-lg">
                <Filter className="h-3.5 w-3.5" />
                {envFilter === "all" ? t('filter.environment') : envFilter}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="end">
              {ENV_FILTERS.map((env) => (
                <button
                  key={env}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => {
                    setEnvFilter(env);
                    setEnvOpen(false);
                  }}
                >
                  <Check
                    className={`h-4 w-4 ${envFilter === env ? "opacity-100" : "opacity-0"}`}
                  />
                  {env === "all" ? t('filter.all') : env}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover open={statusOpen} onOpenChange={setStatusOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 rounded-lg">
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === "all"
                  ? t('filter.status')
                  : t(STATUS_CONFIG_KEYS[statusFilter as RestoreJob["status"]])}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="end">
              {STATUS_FILTERS.map((status) => (
                <button
                  key={status}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onClick={() => {
                    setStatusFilter(status);
                    setStatusOpen(false);
                  }}
                >
                  <Check
                    className={`h-4 w-4 ${statusFilter === status ? "opacity-100" : "opacity-0"}`}
                  />
                  {status === "all"
                    ? t('filter.all')
                    : t(STATUS_CONFIG_KEYS[status as RestoreJob["status"]])}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Table with stable header and zero-CLS empty state */}
      <div
        ref={tableRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border"
      >
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              <TableHead className="py-3">{t('column.connection')}</TableHead>
              <TableHead className="py-3">{t('column.date')}</TableHead>
              <TableHead className="py-3">{t('column.environment')}</TableHead>
              <TableHead className="py-3">{t('column.status')}</TableHead>
              <TableHead className="py-3 text-right">{t('column.duration')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedJobs.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-64 text-center align-middle">
                  <EmptyState
                    icon={<HistoryIcon className="size-6 text-muted-foreground/60" />}
                    title={t('empty.noRestores')}
                    description={t('empty.noRestoresDescription')}
                    className="py-8"
                  />
                </TableCell>
              </TableRow>
            ) : displayedJobs.map((job) => {
                const info = job.targetConnectionId ? connectionMap.get(job.targetConnectionId) : undefined;
                return (
                  <TableRow key={job.id} className="hover:bg-muted/40">
                    <TableCell className="py-3 max-w-[180px]">
                      {info ? (
                        <div className="flex items-center gap-2">
                          {DB_LOGOS[info.dbType] && (
                            <img src={DB_LOGOS[info.dbType]} alt={info.dbType} className="h-4 w-4 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium" title={info.name}>{info.name}</p>
                            <p className="truncate text-[11px] text-muted-foreground" title={info.database}>{info.database}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 text-xs text-muted-foreground">
                      {job.startedAt ? formatDateTimeShort(job.startedAt) : "-"}
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge variant="outline" className="rounded-full text-xs font-normal">
                        {job.targetEnvironment ?? "-"}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={job.status} />
                        {(job.status === "running" || job.status === "pending") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setJobToCancel(job)}
                            className="h-6 w-6 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t("confirm.cancelJob.confirm")}
                            title={t("confirm.cancelJob.confirm")}
                          >
                            <Ban className="size-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-3 text-right text-xs text-muted-foreground">
                      {job.startedAt
                        ? formatDuration(
                            job.startedAt,
                            job.completedAt ?? null,
                          )
                        : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

      {/* Cancel Restore Confirmation Dialog */}
      <Dialog open={!!jobToCancel} onOpenChange={(open) => !open && setJobToCancel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("confirm.cancelJob.title")}</DialogTitle>
            <DialogDescription>
              {t("confirm.cancelJob.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setJobToCancel(null)}
              disabled={!!cancellingJobId}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleCancelRestore()}
              disabled={!!cancellingJobId}
            >
              {cancellingJobId && (
                <Loader2 className="size-3.5 animate-spin mr-1" aria-hidden="true" />
              )}
              {t("confirm.cancelJob.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
