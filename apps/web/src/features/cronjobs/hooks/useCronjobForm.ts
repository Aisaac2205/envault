import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FormEvent, ChangeEvent } from "react";
import type {
  Cronjob,
  Connection,
  CreateCronjobDto,
  Schedule,
  UpdateCronjobDto,
} from "../types";
import {
  DEFAULT_SCHEDULE,
  EVERY_HOURS_VALUES,
  MAX_DAY_OF_MONTH,
  SCHEDULE_KINDS,
  SCHEDULE_PRESETS,
  changeScheduleKind,
  describeSchedule,
  findPreset,
  scheduleEquals,
  type SchedulePreset,
} from "../lib/schedule";

/**
 * What the frequency select shows: a preset, the custom builder, or, for a job
 * whose schedule the builder cannot represent, that schedule left as it is.
 */
export type ScheduleOption = SchedulePreset["id"] | "custom" | "keep";

export interface CronjobFormData {
  name: string;
  connectionId: string;
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
  /** `null` only while an advanced schedule is left untouched. */
  schedule: Schedule | null;
  scheduleOption: ScheduleOption;
  scheduleSummary: string;
  validationError: string | null;
  weekdaysError: boolean;
  isCustom: boolean;
  isEditMode: boolean;
  /** The edited job has a schedule the builder cannot represent. */
  hasAdvancedSchedule: boolean;
  nameCounts: Record<string, number>;
  hasDuplicateNames: boolean;
  handleChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  handleScheduleOptionChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  handleRepeatChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  handleEveryHoursChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  handleTimeChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleWeekdayToggle: (day: number) => void;
  handleDayOfMonthChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  handleSubmit: (e: FormEvent) => Promise<void>;
}

/**
 * Custom React hook for managing the state, validation and submission of the
 * CronjobForm component. The schedule is a structured object the API turns
 * into a cron expression, so nothing here builds or checks one.
 */
export function useCronjobForm({
  cronjob,
  connections,
  onSubmit,
  isLoading,
}: UseCronjobFormProps): UseCronjobFormReturn {
  const { t } = useTranslation("cronjobs");
  const isEditMode = cronjob !== undefined;
  const hasAdvancedSchedule = isEditMode && (cronjob.schedule ?? null) === null;

  const [formData, setFormData] = useState<CronjobFormData>({
    name: cronjob?.name ?? "",
    connectionId: cronjob?.connectionId ?? "",
  });

  const [schedule, setSchedule] = useState<Schedule | null>(
    isEditMode ? (cronjob.schedule ?? null) : DEFAULT_SCHEDULE,
  );

  // Picking Custom keeps the builder open even when its values happen to
  // match a preset, so it does not vanish while the user is still editing.
  const [customChosen, setCustomChosen] = useState(false);

  const [weekdaysBlocked, setWeekdaysBlocked] = useState(false);
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

  const scheduleOption: ScheduleOption =
    schedule === null
      ? "keep"
      : customChosen
        ? "custom"
        : (findPreset(schedule)?.id ?? "custom");

  const hasNoWeekdays =
    schedule?.kind === "weekly" && schedule.daysOfWeek.length === 0;

  const scheduleSummary = hasNoWeekdays
    ? t("form.schedule.summaryIncomplete")
    : describeSchedule(schedule, t);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name as keyof CronjobFormData]: value }));
    setValidationError(null);
  };

  const handleScheduleOptionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const { value } = e.target;
    if (value === "keep") {
      setSchedule(null);
      setCustomChosen(false);
    } else if (value === "custom") {
      setSchedule((prev) => prev ?? DEFAULT_SCHEDULE);
      setCustomChosen(true);
    } else {
      const preset = SCHEDULE_PRESETS.find((p) => p.id === value);
      if (!preset) return;
      setSchedule(preset.schedule);
      setCustomChosen(false);
    }
    setValidationError(null);
  };

  const handleRepeatChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const kind = SCHEDULE_KINDS.find((k) => k === e.target.value);
    if (!kind) return;
    setSchedule((prev) => changeScheduleKind(prev, kind));
  };

  const handleEveryHoursChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const everyHours = EVERY_HOURS_VALUES.find(
      (hours) => hours === Number(e.target.value),
    );
    if (everyHours === undefined) return;
    setSchedule((prev) =>
      prev?.kind === "every_hours" ? { ...prev, everyHours } : prev,
    );
  };

  const handleTimeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setSchedule((prev) =>
      prev !== null && prev.kind !== "every_hours"
        ? { ...prev, time: value }
        : prev,
    );
  };

  const handleWeekdayToggle = (day: number) => {
    setWeekdaysBlocked(false);
    setSchedule((prev) => {
      if (prev?.kind !== "weekly") return prev;
      const daysOfWeek = prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day].sort((a, b) => a - b);
      return { ...prev, daysOfWeek };
    });
  };

  const handleDayOfMonthChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const dayOfMonth = Number(e.target.value);
    if (!Number.isInteger(dayOfMonth)) return;
    if (dayOfMonth < 1 || dayOfMonth > MAX_DAY_OF_MONTH) return;
    setSchedule((prev) =>
      prev?.kind === "monthly" ? { ...prev, dayOfMonth } : prev,
    );
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
    if (hasNoWeekdays) {
      setWeekdaysBlocked(true);
      return;
    }

    const base = {
      name: formData.name.trim(),
      connectionId: formData.connectionId,
    };

    try {
      if (cronjob) {
        // An update only carries a schedule the user chose; leaving it out
        // keeps the stored one, which is how an advanced schedule survives.
        const changed =
          schedule !== null &&
          !scheduleEquals(schedule, cronjob.schedule ?? null);
        await onSubmit(changed ? { ...base, schedule } : base);
      } else if (schedule !== null) {
        await onSubmit({ ...base, schedule });
      }
    } catch {
      // Parent handle components will catch this error
    }
  };

  return {
    formData,
    schedule,
    scheduleOption,
    scheduleSummary,
    validationError,
    weekdaysError: weekdaysBlocked && hasNoWeekdays,
    isCustom: scheduleOption === "custom",
    isEditMode,
    hasAdvancedSchedule,
    nameCounts,
    hasDuplicateNames,
    handleChange,
    handleScheduleOptionChange,
    handleRepeatChange,
    handleEveryHoursChange,
    handleTimeChange,
    handleWeekdayToggle,
    handleDayOfMonthChange,
    handleSubmit,
  };
}
