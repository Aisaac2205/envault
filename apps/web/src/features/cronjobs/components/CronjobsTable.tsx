import type { Cronjob } from "../types";
import { describeSchedule } from "../lib/schedule";
import { formatDateTimeShort as formatDate, formatEnvironment } from "@/lib/format";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Button } from "@/shared/ui/button";
import { ConnectionLabel } from "@/shared/components/ConnectionLabel";
import { EngineName } from "@/shared/components/EngineIcon";
import { useConnections } from "@/features/connections/hooks/useConnections";
import { ClampText, DataTable, RowActionsMenu, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToggleLeft, ToggleRight, Clock } from "lucide-react";

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
  // schedule, the next run and the last status as labelled lines. From 42rem
  // the columns are fixed: the name takes the rest, with the connection and
  // its environment as its second line instead of two columns.
  const columns: Column<Cronjob>[] = [
    {
      header: t('column.name'),
      accessor: (cronjob) => {
        const connection = resolveConnection(cronjob.connectionId);
        const env = connection?.environment;
        return (
          // In a card the wrapper steps aside: the name is the card's title.
          <div className="flex min-w-0 flex-col gap-0.5 @max-2xl/table:contents">
            <ClampText text={cronjob.name} className="font-medium @max-2xl/table:[overflow-wrap:anywhere]" />
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground @max-2xl/table:hidden">
              <EngineName className="min-w-0 gap-1.5" dbType={connection?.dbType}>
                <ConnectionLabel id={cronjob.connectionId} name={cronjob.connectionName} />
              </EngineName>
              {env ? (
                <span className="shrink-0">
                  <span aria-hidden="true">· </span>
                  {formatEnvironment(env)}
                </span>
              ) : null}
            </div>
          </div>
        );
      },
      align: "left",
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
      stackOnly: true,
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
      stackOnly: true,
    },
    {
      header: t('column.schedule'),
      accessor: (cronjob) => (
        <ClampText text={describeSchedule(cronjob.schedule, t)} className="text-xs" />
      ),
      width: "w-32",
      align: "left",
      stack: "field",
    },
    {
      header: t('column.nextRun'),
      accessor: (cronjob) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap @2xl/table:tabular-nums">
          {formatDate(cronjob.nextRunAt)}
        </span>
      ),
      width: "w-42",
      align: "left",
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
      width: "w-32",
      align: "left",
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
      width: "w-18",
      align: "left",
      stack: "actions",
    },
    {
      // A menu-only column is too narrow for its name, which stays for screen readers.
      header: <span className="@max-4xl/table:sr-only">{t('column.actions')}</span>,
      accessor: (cronjob) => (
        // Every action in the menu; Edit is also a button once the table has the room.
        <div className="flex items-center justify-center gap-1 @2xl/table:justify-start">
          <Button
            variant="outline"
            size="sm"
            className="hidden @4xl/table:inline-flex"
            onClick={() => onEdit(cronjob)}
          >
            {t('action.edit')}
          </Button>
          <RowActionsMenu
            label={t('action.actionsAria', { name: cronjob.name })}
            actions={[
              { label: t('action.edit'), onSelect: () => onEdit(cronjob) },
              { label: t('action.delete'), onSelect: () => onDelete(cronjob.id), destructive: true },
            ]}
            className="size-11 @2xl/table:size-8"
          />
        </div>
      ),
      width: "w-14 @4xl/table:w-32",
      align: "left",
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
      layout="fixed"
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
