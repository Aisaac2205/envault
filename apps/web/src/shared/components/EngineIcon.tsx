import type { ReactNode } from "react";
import MySQL from "@/shared/assets/MySQL.svg";
import PostgresSQL from "@/shared/assets/PostgresSQL.svg";
import { cn } from "@/shared/lib/cn";

type KnownEngine = "postgresql" | "mysql";

/** The official engine logos, the same files and size the connection screens use. */
const ENGINE_LOGOS: Record<KnownEngine, string> = {
  postgresql: PostgresSQL,
  mysql: MySQL,
};

/** The full name of each engine with a logo: the logo's accessible name and its hover text. */
const ENGINE_NAMES: Record<KnownEngine, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
};

function knownEngine(dbType: string | null | undefined): KnownEngine | null {
  const engine = dbType?.toLowerCase();
  if (engine === "postgres" || engine === "postgresql") return "postgresql";
  if (engine === "mysql") return "mysql";
  return null;
}

/**
 * The official logo of the engine a connection speaks, named for it (the name
 * is also its hover text): the rows that show it name the connection, never
 * the engine. Nothing for an engine without a logo.
 */
export function EngineLogo({ dbType }: { dbType: string | null | undefined }) {
  const engine = knownEngine(dbType);
  if (engine === null) return null;

  return (
    <img
      alt={ENGINE_NAMES[engine]}
      className="size-5 shrink-0"
      src={ENGINE_LOGOS[engine]}
      title={ENGINE_NAMES[engine]}
    />
  );
}

interface EngineNameProps {
  dbType: string | null | undefined;
  children: ReactNode;
  /** Shown after the name when the engine has no logo; without it the name stands alone. */
  fallback?: ReactNode;
  /** Sets the font size and line height the mark aligns to: the name's own. */
  className?: string;
  /** Classes for the logo's box, such as showing it only in a stacked table row. */
  markClassName?: string;
}

/**
 * A connection name with its engine beside it. The logo leads, so in a table the
 * logos form one column and in a narrow card it never wraps onto a line of its
 * own; a fallback trails, since a word read before the name would push every
 * name out of line. The mark sits in a box one line of the name tall, so it
 * stays level with the first line when a long name wraps.
 */
export function EngineName({ dbType, children, fallback, className, markClassName }: EngineNameProps) {
  const leads = knownEngine(dbType) !== null;
  const trailing = leads ? null : fallback;

  return (
    <div className={cn("flex min-w-0 items-start gap-2", className)}>
      {leads ? (
        <span className={cn("flex h-[1lh] shrink-0 items-center", markClassName)}>
          <EngineLogo dbType={dbType} />
        </span>
      ) : null}
      {children}
      {trailing ? <span className="flex h-[1lh] shrink-0 items-center">{trailing}</span> : null}
    </div>
  );
}
