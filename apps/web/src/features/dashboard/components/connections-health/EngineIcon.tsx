import type { ReactNode } from "react";
import MySQL from "@/shared/assets/MySQL.svg";
import PostgresSQL from "@/shared/assets/PostgresSQL.svg";
import { EngineChip } from "./HealthCells";
import { ENGINE_NAMES, knownEngine } from "./health-data";

/** The official engine logos the connection screens use, at icon size so a name keeps its two lines on a phone. */
const ENGINE_LOGOS = {
  postgresql: PostgresSQL,
  mysql: MySQL,
} as const;

/**
 * Which engine the connection speaks: its official logo, named for it (the name is
 * also its hover text), or the text chip for an engine without a logo.
 */
export function EngineMark({ dbType }: { dbType: string }) {
  const engine = knownEngine(dbType);
  if (engine === null) return <EngineChip dbType={dbType} />;

  return (
    <img
      alt={ENGINE_NAMES[engine]}
      className="size-4 shrink-0"
      src={ENGINE_LOGOS[engine]}
      title={ENGINE_NAMES[engine]}
    />
  );
}

/**
 * A connection name with its engine beside it. The logo leads, so in a table the
 * logos form one column and in a narrow card it never wraps onto a line of its
 * own; the text chip of an unknown engine trails, since a word read before the
 * name would push every name out of line. The mark sits in a box one line of the
 * name tall (`text-sm leading-snug`, as every name here is set), so it stays
 * level with the first line when a long name wraps.
 */
export function EngineName({ dbType, children }: { dbType: string; children: ReactNode }) {
  const leads = knownEngine(dbType) !== null;
  const mark = (
    <span className="flex h-[1lh] shrink-0 items-center text-sm leading-snug">
      <EngineMark dbType={dbType} />
    </span>
  );

  return (
    <div className="flex min-w-0 items-start gap-2">
      {leads && mark}
      {children}
      {!leads && mark}
    </div>
  );
}
