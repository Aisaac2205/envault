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

/**
 * Per theme adjustments the official files need. The MySQL blue (#00618A) has about
 * 2.5:1 on the dark card and 2:1 on a hovered row; dark mode lifts it to #0092CF,
 * about 4.9:1 and 4:1. Light mode keeps the official colours. An <img> SVG cannot see
 * the app theme, so the lift is a class on the image.
 */
const ENGINE_LOGO_CLASSES: Record<KnownEngine, string> = {
  postgresql: "",
  mysql: "dark:brightness-150",
};

function knownEngine(dbType: string | null | undefined): KnownEngine | null {
  const engine = dbType?.toLowerCase();
  if (engine === "postgres" || engine === "postgresql") return "postgresql";
  if (engine === "mysql") return "mysql";
  return null;
}

/** The theme classes of an engine's logo, for the screens that draw the file themselves. */
// eslint-disable-next-line react-refresh/only-export-components -- helper co-located with EngineLogo, which applies the same classes; splitting it into its own file only for Fast Refresh is out of scope here
export function engineLogoClass(dbType: string | null | undefined): string {
  const engine = knownEngine(dbType);
  return engine === null ? "" : ENGINE_LOGO_CLASSES[engine];
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
      className={cn("size-5 shrink-0", ENGINE_LOGO_CLASSES[engine])}
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
