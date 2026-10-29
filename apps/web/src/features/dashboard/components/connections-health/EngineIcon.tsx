import type { ReactNode } from "react";
import { EngineLogo, EngineName as SharedEngineName } from "@/shared/components/EngineIcon";
import { EngineChip } from "./HealthCells";
import { knownEngine } from "./health-data";

/**
 * Which engine the connection speaks: the official logo every table shows, or
 * the text chip for an engine without a logo.
 */
export function EngineMark({ dbType }: { dbType: string }) {
  if (knownEngine(dbType) === null) return <EngineChip dbType={dbType} />;
  return <EngineLogo dbType={dbType} />;
}

/**
 * A connection name with its engine beside it: the logo leads, the text chip of
 * an unknown engine trails. The mark is one line of the name tall, and every name
 * here is set `text-sm leading-snug`.
 */
export function EngineName({ dbType, children }: { dbType: string; children: ReactNode }) {
  return (
    <SharedEngineName
      className="text-sm leading-snug"
      dbType={dbType}
      fallback={<EngineChip dbType={dbType} />}
    >
      {children}
    </SharedEngineName>
  );
}
