import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { ALL_CONNECTIONS } from "./dump-duration-data";

interface ConnectionFilterProps {
  connections: { id: string; name: string }[];
  /** `ALL_CONNECTIONS` or a connection id. */
  value: string;
  onValueChange: (value: string) => void;
}

/** "All connections" plus one option per connection. */
export function ConnectionFilter({
  connections,
  value,
  onValueChange,
}: ConnectionFilterProps) {
  const { t } = useTranslation("dashboard");

  const sorted = useMemo(
    () => [...connections].sort((a, b) => a.name.localeCompare(b.name)),
    [connections],
  );

  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger
        aria-label={t("duration.connection.label")}
        // 44px tall on touch screens, the compact 36px from sm up.
        className="data-[size=default]:h-11 sm:w-64 sm:data-[size=default]:h-9"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CONNECTIONS}>{t("duration.connection.all")}</SelectItem>
        {sorted.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connection.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
