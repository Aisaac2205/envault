import { isProdConnection, type Connection, type ConnectionTestResult } from "../types";
import { ConnectionStateBadge } from "@/shared/components/ConnectionStateBadge";
import { Button } from "@/shared/ui/button";
import { DataTable, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import TestConnectionBadge from "./TestConnectionBadge";
import PostgresSQL from "@/shared/assets/PostgresSQL.svg";
import MySQL from "@/shared/assets/MySQL.svg";
import { useTranslation } from "react-i18next";
import { formatEnvironment } from "@/lib/format";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Ellipsis, ClipboardList } from "lucide-react";

interface ConnectionsTableProps {
  connections: Connection[];
  isLoading: boolean;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onTest: (id: string) => void;
  testResults: Record<string, ConnectionTestResult>;
  testLoading: Record<string, boolean>;
}

const DB_ICONS: Record<string, string> = {
  postgres: PostgresSQL,
  mysql: MySQL,
};

export default function ConnectionsTable({
  connections,
  isLoading,
  onEdit,
  onDelete,
  onTest,
  testResults,
  testLoading,
}: ConnectionsTableProps) {
  const { t } = useTranslation('connections')
  // Narrower than 42rem each connection becomes a card: the name and its state
  // first, the environment below, and a last line with the test result and the
  // actions menu. The connection details stay in the wide table and the form.
  const columns: Column<Connection>[] = [
    {
      header: t('column.name'),
      accessor: (c) => c.name,
      className: "font-medium",
      stack: "title",
    },
    {
      header: t('column.environment'),
      accessor: (c) => (
        <span className="text-xs text-muted-foreground">
          {formatEnvironment(c.environment)}
        </span>
      ),
      stack: "meta",
    },
    {
      header: t('column.type'),
      accessor: (c) => (
        <div className="flex items-center justify-center gap-1.5">
          <img
            src={DB_ICONS[c.dbType]}
            alt={c.dbType}
            className="h-5 w-5"
          />
          <span className="text-xs text-muted-foreground capitalize">
            {c.dbType}
          </span>
        </div>
      ),
      priority: 2,
    },
    {
      header: t('column.host'),
      accessor: (c) => (
        <span className="truncate font-mono text-xs">{c.host}</span>
      ),
      priority: 2,
    },
    {
      header: t('column.port'),
      accessor: (c) => (
        <span className="font-mono text-xs">{c.port}</span>
      ),
      priority: 2,
    },
    {
      header: t('column.database'),
      accessor: (c) => c.database,
      className: "truncate",
      priority: 2,
    },
    {
      header: t('column.status'),
      accessor: (c) => <ConnectionStateBadge isActive={c.isActive} />,
      stack: "badge",
    },
    {
      header: t('column.actions'),
      accessor: (c) => {
        const isTesting = testLoading[c.id] ?? false;
        const testResult = testResults[c.id] ?? null;
        // The API refuses every change to a PROD connection, so it offers no Edit.
        const canEdit = !isProdConnection(c);

        return (
          <div className="flex items-center justify-center gap-2 whitespace-nowrap @max-2xl/table:w-full @max-2xl/table:justify-between @max-2xl/table:*:min-w-0 @max-2xl/table:*:whitespace-normal">
            {/* Wide table: the full button row */}
            <div className="hidden @2xl/table:flex items-center gap-2">
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(c)}>
                  {t('action.edit')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onDelete(c)}>
                {t('action.delete')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTest(c.id)}
                disabled={isTesting}
              >
                {isTesting ? t('action.testing') : t('action.test')}
              </Button>
            </div>

            {/* One result for both layouts: after the buttons, or beside the menu in a card. */}
            <TestConnectionBadge result={testResult} isLoading={isTesting} />

            {/* Narrow table: dropdown menu */}
            <div className="@2xl/table:hidden ml-auto flex items-center justify-center">
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
                    {canEdit && (
                      <DropdownMenuPrimitive.Item
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                        onSelect={() => onEdit(c)}
                      >
                        {t('action.edit')}
                      </DropdownMenuPrimitive.Item>
                    )}
                    <DropdownMenuPrimitive.Item
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                      onSelect={() => onDelete(c)}
                    >
                      {t('action.delete')}
                    </DropdownMenuPrimitive.Item>
                    <DropdownMenuPrimitive.Item
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                      onSelect={() => onTest(c.id)}
                      disabled={isTesting}
                    >
                      {isTesting ? t('action.testing') : t('action.test')}
                    </DropdownMenuPrimitive.Item>
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
            </div>
          </div>
        );
      },
      stack: "footer",
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={connections}
      loading={isLoading}
      caption={t('page.title')}
      narrowLayout="stack"
      emptyMessage={t('empty.filtered.title')}
      emptyContent={
        <EmptyState
          icon={<ClipboardList className="size-6 text-muted-foreground/60" />}
          title={t('empty.filtered.title')}
          description={t('empty.filtered.description')}
          className="py-6"
        />
      }
    />
  );
}
