import type { Cronjob } from "../types";
import { describeSchedule } from "../lib/schedule";
import { formatDateTimeShort as formatDate, formatEnvironment } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Button } from "@/shared/ui/button";
import { ConnectionLabel } from "@/shared/components/ConnectionLabel";
import { EngineName } from "@/shared/components/EngineIcon";
import { useConnections } from "@/features/connections/hooks/useConnections";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToggleLeft, ToggleRight, Ellipsis, Clock } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

interface CronjobsTableProps {
  cronjobs: Cronjob[];
  isLoading: boolean;
  onEdit: (cronjob: Cronjob) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  toggleLoading: Record<string, boolean>;
}


export default function CronjobsTable({
  cronjobs,
  isLoading,
  onEdit,
  onDelete,
  onToggle,
  toggleLoading,
}: CronjobsTableProps) {
  const { t } = useTranslation('cronjobs')
  const { data: connections } = useConnections();
  const resolveConnection = (connectionId: string) =>
    connections?.find((c) => c.id === connectionId);
  const resolveEnv = (connectionId: string): string | undefined =>
    resolveConnection(connectionId)?.environment;

  // Narrower than 42rem each cronjob becomes a card: the name with its switch
  // and actions menu, then the connection and its environment, then the
  // schedule, the next run and the last status as labelled lines.
  const columns: Column<Cronjob>[] = [
    {
      header: t('column.name'),
      accessor: (cronjob) => (
        <span className="font-medium @max-2xl/table:[overflow-wrap:anywhere]">{cronjob.name}</span>
      ),
      stack: "title",
    },
    {
      header: t('column.connection'),
      accessor: (cronjob) => (
        <EngineName
          className="inline-flex max-w-full"
          dbType={resolveConnection(cronjob.connectionId)?.dbType}
        >
          <ConnectionLabel
            id={cronjob.connectionId}
            name={cronjob.connectionName}
          />
        </EngineName>
      ),
      stack: "meta",
    },
    {
      header: t('column.environment'),
      accessor: (cronjob) => {
        const env = resolveEnv(cronjob.connectionId);
        return env ? (
          <span className="text-muted-foreground text-xs">
            {formatEnvironment(env)}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
      stack: "meta",
    },
    {
      header: t('column.schedule'),
      accessor: (cronjob) => (
        <span className="text-xs">{describeSchedule(cronjob.schedule, t)}</span>
      ),
      stack: "field",
    },
    {
      header: t('column.nextRun'),
      accessor: (cronjob) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(cronjob.nextRunAt)}
        </span>
      ),
      stack: "field",
    },
    {
      header: t('column.lastStatus'),
      accessor: (cronjob) =>
        cronjob.lastStatus ? (
          <StatusBadge status={cronjob.lastStatus} />
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
      stack: "field",
    },
    {
      header: t('column.active'),
      accessor: (cronjob) => {
        const isToggling = toggleLoading[cronjob.id] ?? false;
        return (
          <button
            type="button"
            role="switch"
            aria-checked={cronjob.isActive}
            aria-label={
              cronjob.isActive ? t('toggle.deactivate') : t('toggle.activate')
            }
            disabled={isToggling}
            onClick={() => onToggle(cronjob.id)}
            // A 20px mark with a 44px target in the card.
            className="rounded-md text-muted-foreground transition-transform duration-[160ms] ease-out active:scale-[0.97] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 @max-2xl/table:inline-flex @max-2xl/table:size-11 @max-2xl/table:items-center @max-2xl/table:justify-center"
          >
            {cronjob.isActive ? (
              <ToggleRight className="h-5 w-5 text-primary" />
            ) : (
              <ToggleLeft className="h-5 w-5" />
            )}
          </button>
        );
      },
      stack: "actions",
    },
    {
      header: t('column.actions'),
      accessor: (cronjob) => (
        <>
          {/* Wide table: the full button row */}
          <div className="hidden @2xl/table:flex items-center justify-center gap-2 whitespace-nowrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(cronjob)}
            >
              {t('action.edit')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDelete(cronjob.id)}
            >
              {t('action.delete')}
            </Button>
          </div>

          {/* Narrow table: dropdown menu */}
          <div className="@2xl/table:hidden flex items-center justify-center">
            <DropdownMenuPrimitive.Root>
              <DropdownMenuPrimitive.Trigger asChild>
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('column.actions')}
                >
                  <Ellipsis className="h-4 w-4" />
                </button>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal>
                <DropdownMenuPrimitive.Content
                  className="z-50 min-w-[8rem] rounded-md border bg-background p-1 shadow-md"
                  align="end"
                >
                  <DropdownMenuPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                    onSelect={() => onEdit(cronjob)}
                  >
                    {t('action.edit')}
                  </DropdownMenuPrimitive.Item>
                  <DropdownMenuPrimitive.Item
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                    onSelect={() => onDelete(cronjob.id)}
                  >
                    {t('action.delete')}
                  </DropdownMenuPrimitive.Item>
                </DropdownMenuPrimitive.Content>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>
          </div>
        </>
      ),
      stack: "actions",
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={cronjobs}
      loading={isLoading}
      caption={t('nav.cronjobs', { ns: 'common' })}
      narrowLayout="stack"
      emptyMessage={t('empty.title')}
      emptyContent={
        <EmptyState
          icon={<Clock className="size-6 text-muted-foreground/60" />}
          title={t('empty.title')}
          description={t('empty.description')}
          className="py-6"
        />
      }
      className="rounded-xl bg-card shadow-sm overflow-hidden"
    />
  );
}
