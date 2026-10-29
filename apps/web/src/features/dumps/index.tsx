import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useBackupStreams, useDumps, useProdConnections } from "./hooks";
import { dumpsApi } from "./api/dumps-api";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/shared/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import postgresIcon from "@/shared/assets/PostgresSQL.svg";
import mysqlIcon from "@/shared/assets/MySQL.svg";
import { engineLogoClass } from "@/shared/components/EngineIcon";
import { cn } from "@/shared/lib/cn";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "@/shared/ui/pagination";
import { GlobalLoadingOverlay } from "@/shared/ui/TetrominoLoader";
import { useSmoothLoading } from "@/shared/hooks/useSmoothLoading";
import { DumpsStats } from "./components/DumpsStats";
import { DumpsTable } from "./components/DumpsTable";
import DumpsFilters from "./components/DumpsFilters";
import type { DumpsFilters as DumpsFiltersType } from "./types";

const DEFAULT_PAGE_SIZE = 25;

export default function Dumps() {
  const { t } = useTranslation('dumps');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [filters, setFilters] = useState<DumpsFiltersType>({});

  const {
    data: dumps,
    total,
    isLoading: dumpsLoading,
    error: dumpsError,
  } = useDumps({ page, pageSize, filters });

  // Follows pending/running backups (and the ones triggered here) until they finish.
  const { track } = useBackupStreams(dumps);

  const { data: connections = [], isLoading: connectionsLoading } = useProdConnections();
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [backupError, setBackupError] = useState<string | null>(null);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const rawLoading = dumpsLoading || connectionsLoading;
  const isQueryLoading = useSmoothLoading(rawLoading);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const selectedConnection = connections.find(
    (c) => c.id === selectedConnectionId,
  );

  const handleOpenConfirm = () => {
    if (!selectedConnectionId) return;
    setIsConfirmOpen(true);
  };

  const handleExecuteCreateBackup = async () => {
    if (!selectedConnectionId) return;
    setIsConfirmOpen(false);
    setIsCreatingBackup(true);
    setBackupError(null);

    try {
      const { jobId } = await dumpsApi.triggerBackup(selectedConnectionId);
      // The API only queues the job; the final toast comes from its SSE stream.
      toast.success(t('toast.queued'));
      track(jobId);
      await queryClient.invalidateQueries({ queryKey: ["dumps"] });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('toast.createError');
      setBackupError(message);
      toast.error(t('toast.createError'), { description: message });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleApplyFilters = useCallback(
    (newFilters: DumpsFiltersType) => {
      setPage(1); // Reset to first page when filters change
      setFilters(newFilters);
    },
    [],
  );

  const handleResetFilters = useCallback(() => {
    setPage(1);
    setFilters({});
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  return (
    <>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <PageHeader
          title="Dumps"
          actions={
            // On a phone the picker takes the room the button leaves it, and
            // the button moves under it once the picker would get narrower than
            // its placeholder (13.5rem); then it spans the line.
            <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto sm:flex-nowrap">
              <Select
                value={selectedConnectionId}
                onValueChange={setSelectedConnectionId}
                disabled={isCreatingBackup || connections.length === 0}
              >
                <SelectTrigger className="flex-[1_1_13.5rem] sm:w-[13.5rem] sm:flex-none lg:w-[280px]">
                  <SelectValue
                    placeholder={
                      connections.length === 0
                        ? t('select.noConnections')
                        : t('select.placeholder')
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={c.dbType?.toLowerCase().includes("mysql") ? mysqlIcon : postgresIcon}
                          alt={c.dbType}
                          className={cn("h-4 w-4 shrink-0 object-contain", engineLogoClass(c.dbType))}
                        />
                        <span className="truncate">{c.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleOpenConfirm}
                disabled={isCreatingBackup || !selectedConnectionId}
                className="shrink-0 max-sm:grow"
              >
                {isCreatingBackup ? t('action.creating') : t('action.newBackup')}
              </Button>
            </div>
          }
        />

        {(dumpsError || backupError) && (
          <Alert variant="destructive">
            <AlertDescription>
              {backupError ?? dumpsError?.message ?? "Error desconocido"}
            </AlertDescription>
          </Alert>
        )}

        <DumpsFilters
          filters={filters}
          connections={connections}
          onApply={handleApplyFilters}
          onReset={handleResetFilters}
        />

        <DumpsStats dumps={dumps} />
        <DumpsTable
          dumps={dumps}
          isLoading={isQueryLoading}
          total={total}
          page={page}
          pageSize={pageSize}
          pagination={
            totalPages > 1 ? (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => handlePageChange(Math.max(1, page - 1))}
                      disabled={page <= 1}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(
                      (p) =>
                        p === 1 ||
                        p === totalPages ||
                        Math.abs(p - page) <= 1,
                    )
                    .map((p, idx, arr) => {
                      const items: React.ReactNode[] = [];
                      if (idx > 0 && p - arr[idx - 1] > 1) {
                        items.push(
                          <PaginationItem key={`ellipsis-${p}`}>
                            {/* The slot lets a short pagination hide it with the other pages. */}
                            <span
                              data-slot="pagination-ellipsis"
                              className="flex h-9 w-9 items-center justify-center text-sm text-muted-foreground"
                            >
                              ...
                            </span>
                          </PaginationItem>,
                        );
                      }
                      items.push(
                        <PaginationItem key={p}>
                          <PaginationLink
                            isActive={p === page}
                            onClick={() => handlePageChange(p)}
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>,
                      );
                      return items;
                    })}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() =>
                        handlePageChange(Math.min(totalPages, page + 1))
                      }
                      disabled={page >= totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            ) : undefined
          }
        />
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('confirm.title')}</DialogTitle>
            <DialogDescription>
              {t('confirm.description', {
                name: selectedConnection?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>

          {selectedConnection && (
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3.5 py-2.5">
              <img
                src={selectedConnection.dbType?.toLowerCase().includes("mysql") ? mysqlIcon : postgresIcon}
                alt={selectedConnection.dbType}
                className={cn("h-5 w-5 shrink-0 object-contain", engineLogoClass(selectedConnection.dbType))}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary truncate">
                  {selectedConnection.name}
                </p>
                <p className="text-xs text-muted-foreground uppercase font-mono tracking-wider">
                  {selectedConnection.dbType ?? "postgres"}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline">{t('confirm.cancel')}</Button>
            </DialogClose>
            <Button onClick={() => void handleExecuteCreateBackup()}>
              {t('confirm.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Global Loading Overlay with Tetromino animation and smooth blur */}
      <GlobalLoadingOverlay
        open={isQueryLoading || isCreatingBackup}
        label={isCreatingBackup ? t('loading.title') : t('loading.fetching', { defaultValue: 'Cargando respaldos...' })}
        sublabel={isCreatingBackup ? t('loading.subtitle') : undefined}
      />
    </>
  );
}
