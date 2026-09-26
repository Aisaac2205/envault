import { cn } from "@/shared/lib/cn";
import type { Connection } from "../types";

interface ConnectionDetailsProps {
  connection: Connection;
  isActive?: boolean;
}

export function ConnectionDetails({ connection, isActive = false }: ConnectionDetailsProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs transition-all",
        isActive && "rounded-xl border border-border bg-muted/40 p-2.5 shadow-xs",
      )}
    >
      <span className="text-muted-foreground">Host</span>
      <span className="truncate font-medium text-text-primary">{connection.host}</span>

      <span className="text-muted-foreground">Puerto</span>
      <span className="truncate font-medium text-text-primary">{connection.port}</span>

      <span className="text-muted-foreground">DB</span>
      <span className="truncate font-medium text-text-primary">{connection.database}</span>

      <span className="text-muted-foreground">Usuario</span>
      <span className="truncate font-medium text-text-primary">{connection.username ?? "-"}</span>
    </div>
  );
}
