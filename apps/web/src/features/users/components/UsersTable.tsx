import { UserX, ShieldOff } from "lucide-react";
import { Badge, BadgeDot } from "@/shared/ui/badge";
import { ClampText, DataTable, type Column } from "@/shared/ui/data-table";
import { EmptyState } from "@/shared/ui/empty-state";
import { UserActions } from "./UserActions";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import type { User } from "../types";

function RoleBadge({ role, t }: { role: User["role"]; t: (key: string) => string }) {
  const isAdmin = role === "admin";
  return (
    <Badge variant="outline">
      <BadgeDot tone={isAdmin ? "success" : "neutral"} />
      {isAdmin ? t('role.admin') : t('role.user')}
    </Badge>
  );
}

function BannedBadge({ t }: { t: (key: string) => string }) {
  return (
    <Badge variant="outline" className="ml-2 @max-2xl/table:ml-0">
      <BadgeDot tone="error" />
      {t('status.banned')}
    </Badge>
  );
}

interface UsersTableProps {
  users: User[];
  loading: boolean;
  /** When true, shows a different empty state (used when filters are active). */
  filtered?: boolean;
}

export function UsersTable({ users, loading, filtered = false }: UsersTableProps) {
  const { t } = useTranslation('users')

  // Narrower than 42rem each user becomes a card: the name (and a suspended
  // badge) with the actions beside it, then the email, then the role and the
  // creation date as labelled lines. From 42rem the columns are fixed: the
  // name takes the rest, with the email as its second line.
  const columns: Column<User>[] = [
    {
      header: t('column.name'),
      accessor: (u) => (
        // In a card the wrapper steps aside: the name line is the card's title.
        <div className="flex min-w-0 flex-col gap-0.5 @max-2xl/table:contents">
          <div className="flex min-w-0 items-center gap-2 @max-2xl/table:flex-wrap @max-2xl/table:gap-y-1">
            <ClampText text={u.name} className="font-medium @max-2xl/table:[overflow-wrap:anywhere]" />
            {u.banned && <BannedBadge t={t} />}
          </div>
          <span className="truncate text-xs text-muted-foreground @max-2xl/table:hidden" title={u.email}>
            {u.email}
          </span>
        </div>
      ),
      align: "left",
      stack: "title",
    },
    {
      header: t('column.email'),
      accessor: (u) => (
        <span
          className="text-xs text-muted-foreground @max-2xl/table:[overflow-wrap:anywhere]"
          title={u.email}
        >
          {u.email}
        </span>
      ),
      stack: "meta",
      stackOnly: true,
    },
    {
      header: t('column.role'),
      accessor: (u) => <RoleBadge role={u.role} t={t} />,
      width: "w-36",
      align: "left",
      stack: "field",
    },
    {
      header: t('column.created'),
      accessor: (u) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground @max-2xl/table:text-xs @max-2xl/table:whitespace-normal">
          {formatDate(u.createdAt)}
        </span>
      ),
      width: "w-28",
      align: "left",
      stack: "field",
    },
    {
      header: <span className="sr-only">{t('column.actions')}</span>,
      accessor: (u) => <UserActions user={u} />,
      width: "w-48",
      stack: "actions",
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={users}
      loading={loading}
      caption={t('page.title')}
      narrowLayout="stack"
      layout="fixed"
      emptyMessage={filtered ? t('empty.filtered.title') : t('empty.title')}
      emptyContent={
        <EmptyState
          icon={filtered ? <ShieldOff className="size-6 text-muted-foreground/60" /> : <UserX className="size-6 text-muted-foreground/60" />}
          title={filtered ? t('empty.filtered.title') : t('empty.title')}
          description={filtered ? t('empty.filtered.description') : t('empty.description')}
          className="py-6"
        />
      }
    />
  );
}
