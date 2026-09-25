import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BackupCategory } from "@/types/backup.types";
import type { Connection } from "../types";
import type { EnrichedR2Object } from "@/features/dumps/types";
import { SourceConnectionCombobox } from "./SourceConnectionCombobox";
import { FrequencyTabs } from "./FrequencyTabs";
import { DumpsList } from "./DumpsList";
import { useR2Dumps } from "../hooks/useR2Dumps";

interface R2DumpPickerProps {
  value: EnrichedR2Object | null;
  onChange: (dump: EnrichedR2Object | null) => void;
  connections: Connection[];
  connectionsLoading?: boolean;
  disabled?: boolean;
}

export function R2DumpPicker({
  value,
  onChange,
  connections,
  connectionsLoading = false,
  disabled = false,
}: R2DumpPickerProps) {
  const [connectionSlug, setConnectionSlug] = useState<string | null>(
    value?.connectionSlug ?? null,
  );
  const [category, setCategory] = useState<BackupCategory | null>(
    value?.category ?? null,
  );

  const { data: allDumps = [], isLoading: dumpsLoading } = useR2Dumps({
    connectionSlug,
    category,
  });

  // Show only the 12 most recent dumps per frequency
  const dumps = allDumps.slice(0, 12);

  // Clear current selection if the user changes the source filter or category
  useEffect(() => {
    if (!value) return;
    const isStillCompatible =
      value.connectionSlug === connectionSlug && value.category === category;
    if (!isStillCompatible) {
      onChange(null);
    }
  }, [connectionSlug, category, value, onChange]);

  function handleConnectionChange(slug: string | null) {
    setConnectionSlug(slug);
    setCategory(null);
  }

  const { t } = useTranslation("restore");

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="source-connection"
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {t("picker.database")}
        </label>
        <div id="source-connection">
          <SourceConnectionCombobox
            connections={connections}
            value={connectionSlug}
            onChange={handleConnectionChange}
            disabled={disabled}
            loading={connectionsLoading}
          />
        </div>
      </div>

      {connectionSlug && (
        <div>
          <span
            id="frequency-label"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {t("picker.frequency")}
          </span>
          <FrequencyTabs
            value={category}
            onChange={setCategory}
            disabled={disabled}
          />
        </div>
      )}

      {connectionSlug && category && (
        <div>
          <span
            id="dumps-list-label"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            {t("picker.dumpsAvailable")}
          </span>
          <DumpsList
            dumps={dumps}
            value={value}
            onChange={onChange}
            loading={dumpsLoading}
            disabled={disabled}
            label={t("picker.dumpsAvailable")}
          />
        </div>
      )}
    </div>
  );
}
