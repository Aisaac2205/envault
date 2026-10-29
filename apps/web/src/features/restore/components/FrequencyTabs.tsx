import { useTranslation } from "react-i18next";
import type { BackupCategory } from "@/types/backup.types";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";

interface FrequencyTabsProps {
  value: BackupCategory | null;
  onChange: (category: BackupCategory) => void;
  disabled?: boolean;
}

interface TabDef {
  value: BackupCategory;
  label: string;
  shortLabel: string;
}

function getTabDefs(t: (key: string) => string): readonly TabDef[] {
  return [
    { value: "hourly", label: t("freq.hourly"), shortLabel: t("freq.hourShort") },
    { value: "daily", label: t("freq.daily"), shortLabel: t("freq.dayShort") },
    { value: "weekly", label: t("freq.weekly"), shortLabel: t("freq.weekShort") },
    { value: "custom", label: t("freq.custom"), shortLabel: "Custom" },
    { value: "manual", label: t("freq.manual"), shortLabel: "Manual" },
  ] as const;
}

export function FrequencyTabs({
  value,
  onChange,
  disabled = false,
}: FrequencyTabsProps) {
  const { t } = useTranslation("restore");
  const tabs = getTabDefs(t);

  return (
    <Tabs
      value={value ?? ""}
      onValueChange={(next) => onChange(next as BackupCategory)}
      aria-label={t("freq.ariaLabel")}
      className="@container/frequency"
    >
      {/* Five equal cells need about 19rem (54 px a tab) to hold the longest
          label. With less room (a phone, or the narrow form column of 1024-1280
          px screens) the tabs share a wrapping row where each keeps at least its
          label width; the room, not the viewport, picks the layout. */}
      <TabsList className="flex h-auto min-h-9 w-full flex-wrap gap-1 rounded-md p-1 @[19rem]/frequency:grid @[19rem]/frequency:h-9 @[19rem]/frequency:grid-cols-5">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            disabled={disabled}
            aria-label={tab.label}
            title={tab.label}
            className="flex-1 rounded-sm px-1.5 py-1 text-[11px] leading-tight"
          >
            {tab.shortLabel}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
