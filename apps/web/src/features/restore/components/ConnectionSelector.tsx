import { useState } from "react";
import { Check, ChevronsUpDown, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Connection } from "../types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import postgresSvg from "@/shared/assets/PostgresSQL.svg";
import mysqlSvg from "@/shared/assets/MySQL.svg";
import { engineLogoClass } from "@/shared/components/EngineIcon";

interface ConnectionSelectorProps {
  connections: Connection[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

const DB_LOGOS: Record<string, string> = {
  postgres: postgresSvg as string,
  mysql: mysqlSvg as string,
};

function DbTypeLogo({ dbType }: { dbType: string }) {
  const logo = DB_LOGOS[dbType];
  if (!logo) return null;
  return (
    <img
      src={logo}
      alt={dbType}
      className={cn("size-5 shrink-0", engineLogoClass(dbType))}
    />
  );
}

function ConnectionItem({
  conn,
  isSelected,
  onSelect,
}: {
  conn: Connection;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={`${conn.name} ${conn.host} ${conn.database} ${conn.dbType}`}
      onSelect={onSelect}
      aria-selected={isSelected}
    >
      <Check
        className={cn(
          "size-4 shrink-0 text-text-primary",
          isSelected ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <DbTypeLogo dbType={conn.dbType} />
        <span className="truncate font-medium text-text-primary">{conn.name}</span>
        {conn.environment && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {conn.environment}
          </span>
        )}
      </div>
    </CommandItem>
  );
}

export function ConnectionSelector({
  connections,
  value,
  onChange,
  disabled = false,
}: ConnectionSelectorProps) {
  const { t } = useTranslation("restore");
  const [open, setOpen] = useState(false);

  const selected = connections.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label={t("target.ariaSelect")}
          className="h-10 w-full justify-between rounded-xl bg-muted/40 font-normal hover:bg-muted/60"
          disabled={disabled}
        >
          {selected ? (
            <div className="flex min-w-0 items-center gap-2">
              <DbTypeLogo dbType={selected.dbType} />
              <span className="truncate font-medium">{selected.name}</span>
              {selected.environment && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {selected.environment}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <Wifi className="h-3 w-3" />
                {t("target.connected")}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">{t("target.placeholder")}</span>
          )}
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start" style={{ width: 'var(--radix-popover-trigger-width)' }}>
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("target.search")} />
          <CommandList>
            <CommandEmpty>
              {t("target.empty")}
            </CommandEmpty>
            <CommandGroup>
              {connections.map((conn) => (
                <ConnectionItem
                  key={conn.id}
                  conn={conn}
                  isSelected={value === conn.id}
                  onSelect={() => {
                    onChange(conn.id);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
