import { isProdConnection, type Connection, type ConnectionTestResult } from "../types";
import { ConnectionStateBadge } from "@/shared/components/ConnectionStateBadge";
import { Button } from "@/shared/ui/button";
import { ClampText, DataTable, RowActionsMenu, type Column, type RowAction } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import TestConnectionBadge from "./TestConnectionBadge";
import { EngineName } from "@/shared/components/EngineIcon";
import { useTranslation } from "react-i18next";
import { formatEnvironment } from "@/lib/format";
import { ClipboardList } from "lucide-react";

interface ConnectionsTableProps {
  connections: Connection[];
  isLoading: boolean;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onTest: (id: string) => void;
  testResults: Record<string, ConnectionTestResult>;
  testLoading: Record<string, boolean>;
}

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

  /**
   * Every action of a row, in the order its menus list them. The API refuses
   * every change to a PROD connection, so it offers no Edit.
   */
  const actionsOf = (c: Connection): RowAction[] => {
    const isTesting = testLoading[c.id] ?? false;
    return [
      { label: isTesting ? t('action.testing') : t('action.test'), onSelect: () => onTest(c.id), disabled: isTesting },
      ...(isProdConnection(c) ? [] : [{ label: t('action.edit'), onSelect: () => onEdit(c) }]),
      { label: t('action.delete'), onSelect: () => onDelete(c), destructive: true },
    ];
  };

  const resultOf = (c: Connection) => {
    const isTesting = testLoading[c.id] ?? false;
    const testResult = testResults[c.id] ?? null;
    return isTesting || testResult ? { isTesting, testResult } : null;
  };

  // Narrower than 42rem each connection becomes a card: its engine and name
  // with the state and the actions menu beside them, then the environment,
  // then host:port and the database as labelled lines, and a last line with
  // the test result only once there is one. From 42rem the columns are fixed:
  // the name takes the rest, with the environment and the test result as its
  // second line, and the actions sit in a menu, with the test as a button
  // too once the table has the room.
  const columns: Column<Connection>[] = [
    {
      header: t('column.name'),
      accessor: (c) => {
        const result = resultOf(c);
        return (
          <EngineName dbType={c.dbType}>
            {/* In a card the wrapper steps aside: the name is the card's title. */}
            <div className="flex min-w-0 flex-col gap-0.5 @max-2xl/table:contents">
              <ClampText text={c.name} className="min-w-0 @max-2xl/table:[overflow-wrap:anywhere]" />
              <div className="flex min-w-0 items-center gap-2 font-normal @max-2xl/table:hidden">
                <span className="shrink-0 text-xs text-muted-foreground">{formatEnvironment(c.environment)}</span>
                {result ? (
                  <span data-test-result="" className="flex min-w-0">
                    <TestConnectionBadge result={result.testResult} isLoading={result.isTesting} truncate />
                  </span>
                ) : null}
              </div>
            </div>
          </EngineName>
        );
      },
      className: "font-medium",
      align: "left",
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
      stackOnly: true,
    },
    {
      header: t('column.host'),
      accessor: (c) => (
        <span
          className="truncate font-mono text-xs @2xl/table:block @max-2xl/table:whitespace-normal @max-2xl/table:[overflow-wrap:anywhere]"
          title={`${c.host}:${c.port}`}
        >
          {c.host}
          <span>:{c.port}</span>
        </span>
      ),
      width: "w-40 @4xl/table:w-52 @6xl/table:w-64",
      align: "left",
      stack: "field",
    },
    {
      header: t('column.database'),
      accessor: (c) => (
        <span
          className="min-w-0 truncate @2xl/table:block @max-2xl/table:whitespace-normal @max-2xl/table:font-mono @max-2xl/table:text-xs @max-2xl/table:[overflow-wrap:anywhere]"
          title={c.database}
        >
          {c.database}
        </span>
      ),
      width: "w-32 @4xl/table:w-40 @6xl/table:w-48",
      align: "left",
      stack: "field",
    },
    {
      header: t('column.status'),
      accessor: (c) => (
        <div className="inline-flex items-center gap-1">
          <ConnectionStateBadge isActive={c.isActive} />
          {/* Card: the actions menu, at its top right */}
          <div className="@2xl/table:hidden flex items-center justify-center">
            <RowActionsMenu
              label={t('action.actionsAria', { name: c.name })}
              actions={actionsOf(c)}
              className="size-11"
            />
          </div>
        </div>
      ),
      width: "w-28",
      align: "left",
      stack: "badge",
    },
    {
      // A menu-only column is too narrow for its name, which stays for screen readers.
      header: <span className="@max-4xl/table:sr-only">{t('column.actions')}</span>,
      accessor: (c) => {
        const result = resultOf(c);
        const isTesting = testLoading[c.id] ?? false;

        return (
          <div className="flex items-center justify-start gap-2 whitespace-nowrap @max-2xl/table:w-full @max-2xl/table:*:min-w-0 @max-2xl/table:*:whitespace-normal">
            {/* Table: the menu, with the test as a button beside it once there is room */}
            <div className="hidden @2xl/table:flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="hidden @4xl/table:inline-flex"
                onClick={() => onTest(c.id)}
                disabled={isTesting}
              >
                {isTesting ? t('action.testing') : t('action.test')}
              </Button>
              <RowActionsMenu label={t('action.actionsAria', { name: c.name })} actions={actionsOf(c)} />
            </div>

            {/* Card: the result on its last line; the table shows it under the name. */}
            {result ? (
              <span data-test-result="" className="contents @2xl/table:hidden">
                <TestConnectionBadge result={result.testResult} isLoading={result.isTesting} />
              </span>
            ) : null}
          </div>
        );
      },
      // A card has a result line only while there is a result to show.
      className: "@max-2xl/table:[&:not(:has([data-test-result]))]:hidden",
      width: "w-14 @4xl/table:w-48",
      align: "left",
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
      layout="fixed"
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
