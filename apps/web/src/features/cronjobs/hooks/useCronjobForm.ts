import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormEvent, ChangeEvent } from "react";
import type { CronFrequency } from "@/types/backup.types";
import type {
  Cronjob,
  Connection,
  CreateCronjobDto,
  UpdateCronjobDto,
} from "../types";
import { validateCronExpression } from "../lib/cron-validator";

export interface CronPreset {
  label: string;
  cronExpression: string;
  frequency: CronFrequency;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: "Every hour", cronExpression: "0 * * * *", frequency: "hourly" },
  { label: "Daily at 2am", cronExpression: "0 2 * * *", frequency: "daily" },
  { label: "Weekly (Mon 2am)", cronExpression: "0 2 * * 1", frequency: "weekly" },
  { label: "Custom", cronExpression: "", frequency: "custom" },
] as const;

export const CUSTOM_LABEL = "Custom";

export function detectPresetLabel(
  cronExpression: string,
  frequency: CronFrequency,
): string {
  const match = CRON_PRESETS.find(
    (p) => p.frequency === frequency && p.cronExpression === cronExpression,
  );
  if (match) return match.label;
  return CUSTOM_LABEL;
}

export interface CronjobFormData {
  name: string;
  connectionId: string;
  cronExpression: string;
  frequency: CronFrequency;
}

export interface UseCronjobFormProps {
  cronjob?: Cronjob;
  connections: Connection[];
  onSubmit: (dto: CreateCronjobDto | UpdateCronjobDto) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

export interface UseCronjobFormReturn {
  formData: CronjobFormData;
  selectedPresetLabel: string;
  validationError: string | null;
  isCustom: boolean;
  isEditMode: boolean;
  nameCounts: Record<string, number>;
  hasDuplicateNames: boolean;
  handleChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  handlePresetChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  handleCronExpressionChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: FormEvent) => Promise<void>;
}

/**
 * Custom React hook for managing the state, validation, and presets
 * of the CronjobForm component.
 */
export function useCronjobForm({
  cronjob,
  connections,
  onSubmit,
  isLoading,
}: UseCronjobFormProps): UseCronjobFormReturn {
  const { t } = useTranslation("cronjobs");
  const isEditMode = cronjob !== undefined;

  const initialFrequency: CronFrequency = cronjob?.frequency ?? "custom";
  const initialCronExpression = cronjob?.cronExpression ?? "";

  const [formData, setFormData] = useState<CronjobFormData>({
    name: cronjob?.name ?? "",
    connectionId: cronjob?.connectionId ?? "",
    cronExpression: initialCronExpression,
    frequency: initialFrequency,
  });

  const [selectedPresetLabel, setSelectedPresetLabel] = useState<string>(() =>
    detectPresetLabel(initialCronExpression, initialFrequency),
  );

  const [validationError, setValidationError] = useState<string | null>(null);

  const nameCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const c of connections) {
      counts[c.name] = (counts[c.name] ?? 0) + 1;
    }
    return counts;
  }, [connections]);

  const hasDuplicateNames = useMemo<boolean>(
    () => Object.values(nameCounts).some((n) => n > 1),
    [nameCounts],
  );

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name as keyof CronjobFormData]: value }));
    setValidationError(null);
  };

  const handlePresetChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const label = e.target.value;
    const preset = CRON_PRESETS.find((p) => p.label === label);
    if (!preset) return;
    setSelectedPresetLabel(label);
    setFormData((prev) => ({
      ...prev,
      frequency: preset.frequency,
      cronExpression:
        preset.frequency === "custom"
          ? prev.cronExpression
          : preset.cronExpression,
    }));
    setValidationError(null);
  };

  const handleCronExpressionChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData((prev) => ({
      ...prev,
      cronExpression: value,
      frequency: "custom",
    }));
    setSelectedPresetLabel(CUSTOM_LABEL);
    setValidationError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!formData.name.trim()) {
      setValidationError(t("form.validation.nameRequired"));
      return;
    }
    if (!formData.connectionId) {
      setValidationError(t("form.validation.connectionRequired"));
      return;
    }
    const cronCheck = validateCronExpression(formData.cronExpression);
    if (!cronCheck.valid) {
      setValidationError(
        cronCheck.errorKey
          ? t(cronCheck.errorKey, cronCheck.errorParams)
          : t("form.validation.invalidCron"),
      );
      return;
    }

    try {
      await onSubmit({
        name: formData.name.trim(),
        connectionId: formData.connectionId,
        cronExpression: formData.cronExpression.trim(),
        frequency: formData.frequency,
      });
    } catch {
      // Parent handle components will catch this error
    }
  };

  const isCustom = formData.frequency === "custom";

  return {
    formData,
    selectedPresetLabel,
    validationError,
    isCustom,
    isEditMode,
    nameCounts,
    hasDuplicateNames,
    handleChange,
    handlePresetChange,
    handleCronExpressionChange,
    handleSubmit,
  };
}
