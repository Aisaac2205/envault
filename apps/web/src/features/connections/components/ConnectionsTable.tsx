import type { Connection, ConnectionTestResult } from "../types";
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
  onDelete: (id: string) => void;
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
  const columns: Column<Connection>[] = [
    {
      header: t('column.name'),
      accessor: (c) => c.name,
      className: "font-medium",
    },
    {
      header: t('column.environment'),
      accessor: (c) => (
        <span className="text-xs text-muted-foreground">
          {formatEnvironment(c.environment)}
        </span>
      ),
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
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
    },
    {
      header: t('column.host'),
      accessor: (c) => (
        <span className="truncate font-mono text-xs">{c.host}</span>
      ),
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
    },
    {
      header: t('column.port'),
      accessor: (c) => (
        <span className="font-mono text-xs">{c.port}</span>
      ),
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
    },
    {
      header: t('column.database'),
      accessor: (c) => c.database,
      className: "hidden sm:table-cell truncate",
      headerClassName: "hidden sm:table-cell",
    },
    {
      header: t('column.status'),
      accessor: (c) => <ConnectionStateBadge isActive={c.isActive} />,
    },
    {
      header: t('column.actions'),
      accessor: (c) => {
        const isTesting = testLoading[c.id] ?? false;
        const testResult = testResults[c.id] ?? null;

        return (
          <>
            {/* Desktop: full button row */}
            <div className="hidden sm:flex items-center justify-center gap-2 whitespace-nowrap">
              <Button variant="outline" size="sm" onClick={() => onEdit(c)}>
                {t('action.edit')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onDelete(c.id)}>
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
              <TestConnectionBadge result={testResult} isLoading={isTesting} />
            </div>

            {/* Mobile: dropdown menu */}
            <div className="sm:hidden flex items-center justify-center">
              <DropdownMenuPrimitive.Root>
                <DropdownMenuPrimitive.Trigger asChild>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      onSelect={() => onEdit(c)}
                    >
                      {t('action.edit')}
                    </DropdownMenuPrimitive.Item>
                    <DropdownMenuPrimitive.Item
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
                      onSelect={() => onDelete(c.id)}
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
          </>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={connections}
      loading={isLoading}
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
