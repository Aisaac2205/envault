import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  Cronjob,
  Connection,
  CreateCronjobDto,
  UpdateCronjobDto,
} from "../types";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { useCronjobForm } from "../hooks/useCronjobForm";
import {
  EVERY_HOURS_VALUES,
  MAX_DAY_OF_MONTH,
  SCHEDULE_KINDS,
  SCHEDULE_PRESETS,
  WEEKDAYS_MONDAY_FIRST,
  describeSchedule,
  weekdayName,
} from "../lib/schedule";

interface CronjobFormProps {
  cronjob?: Cronjob;
  connections: Connection[];
  connectionsLoading: boolean;
  onSubmit: (
    dto: CreateCronjobDto | UpdateCronjobDto,
  ) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "text-xs font-semibold text-muted-foreground";

export default function CronjobForm({
  cronjob,
  connections,
  connectionsLoading,
  onSubmit,
  onCancel,
  isLoading,
}: CronjobFormProps) {
  const { t } = useTranslation("cronjobs");
  const {
    formData,
    schedule,
    scheduleOption,
    scheduleSummary,
    validationError,
    weekdaysError,
    isCustom,
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
  } = useCronjobForm({
    cronjob,
    connections,
    onSubmit,
    onCancel,
    isLoading,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEditMode ? t("form.title.edit") : t("form.title.new")}
        </CardTitle>
        <CardDescription>
          {t("form.description")}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Nombre */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="cronjob-name"
                className="text-xs font-semibold text-muted-foreground"
              >
                {t("form.field.name")}
              </label>
              <input
                id="cronjob-name"
                className={inputClass}
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder={t("form.placeholder.name")}
                disabled={isLoading}
              />
            </div>

            {/* Conexión */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="cronjob-connection"
                className="text-xs font-semibold text-muted-foreground"
              >
                {t("form.field.connection")}
              </label>
              {connectionsLoading ? (
                <div
                  className={`${inputClass} animate-pulse text-muted-foreground`}
                  aria-busy="true"
                >
                  {t("form.loadingConnections")}
                </div>
              ) : connections.length === 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("form.noConnections")}
                  </span>
                  <Link
                    to="/connections"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    {t("form.createConnection")}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <>
                  <select
                    id="cronjob-connection"
                    className={inputClass}
                    name="connectionId"
                    value={formData.connectionId}
                    onChange={handleChange}
                    disabled={isLoading}
                  >
                    <option value="">{t("form.selectConnection")}</option>
                    {connections.map((conn) => {
                      const isDuplicate = (nameCounts[conn.name] ?? 0) > 1;
                      const envSuffix = conn.environment
                        ? ` · ${conn.environment}`
                        : "";
                      let disambiguator = "";
                      if (isDuplicate) {
                        if (conn.host && conn.database) {
                          disambiguator = ` - ${conn.host}/${conn.database}`;
                        } else if (conn.database) {
                          disambiguator = ` - ${conn.database}`;
                        } else {
                          disambiguator = ` (#${conn.id.slice(0, 6)})`;
                        }
                      }
                      return (
                        <option key={conn.id} value={conn.id}>
                          {conn.name}
                          {envSuffix}
                          {disambiguator}
                        </option>
                      );
                    })}
                  </select>
                  {hasDuplicateNames && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {t("form.duplicateNamesHint")}{" "}
                      <Link to="/connections" className="underline">
                        Connections
                      </Link>
                      .
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Frecuencia */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="cronjob-preset"
                className="text-xs font-semibold text-muted-foreground"
              >
                {t("form.field.frequency")}
              </label>
              <select
                id="cronjob-preset"
                className={inputClass}
                value={scheduleOption}
                onChange={handleScheduleOptionChange}
                disabled={isLoading}
              >
                {hasAdvancedSchedule && (
                  <option value="keep">{t("form.schedule.keepCurrent")}</option>
                )}
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {describeSchedule(p.schedule, t)}
                  </option>
                ))}
                <option value="custom">{t("form.schedule.custom")}</option>
              </select>
            </div>

            {schedule === null && (
              <p
                role="note"
                className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground md:col-span-2"
              >
                {t("form.schedule.legacyNotice")}
              </p>
            )}

            {/* Constructor de frecuencia personalizada */}
            {isCustom && schedule !== null && (
              <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="cronjob-repeat" className={labelClass}>
                    {t("form.field.repeat")}
                  </label>
                  <select
                    id="cronjob-repeat"
                    className={inputClass}
                    value={schedule.kind}
                    onChange={handleRepeatChange}
                    disabled={isLoading}
                  >
                    {SCHEDULE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`form.repeat.${kind}`)}
                      </option>
                    ))}
                  </select>
                </div>

                {schedule.kind === "every_hours" ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cronjob-every-hours" className={labelClass}>
                      {t("form.field.everyHours")}
                    </label>
                    <select
                      id="cronjob-every-hours"
                      className={inputClass}
                      value={schedule.everyHours}
                      onChange={handleEveryHoursChange}
                      disabled={isLoading}
                    >
                      {EVERY_HOURS_VALUES.map((hours) => (
                        <option key={hours} value={hours}>
                          {describeSchedule(
                            { kind: "every_hours", everyHours: hours },
                            t,
                          )}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cronjob-time" className={labelClass}>
                      {t("form.field.time")}
                    </label>
                    <input
                      id="cronjob-time"
                      className={inputClass}
                      type="time"
                      value={schedule.time}
                      onChange={handleTimeChange}
                      required
                      disabled={isLoading}
                    />
                  </div>
                )}

                {schedule.kind === "weekly" && (
                  <fieldset className="flex min-w-0 flex-col gap-1 md:col-span-2">
                    <legend className={`mb-1 ${labelClass}`}>
                      {t("form.field.weekdays")}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS_MONDAY_FIRST.map((day) => {
                        const pressed = schedule.daysOfWeek.includes(day);
                        return (
                          <Button
                            key={day}
                            type="button"
                            size="sm"
                            variant={pressed ? "default" : "outline"}
                            aria-pressed={pressed}
                            aria-label={weekdayName(day, t, "long")}
                            onClick={() => handleWeekdayToggle(day)}
                            disabled={isLoading}
                          >
                            {weekdayName(day, t, "short")}
                          </Button>
                        );
                      })}
                    </div>
                    {weekdaysError && (
                      <p role="alert" className="text-xs text-destructive">
                        {t("form.validation.weekdaysRequired")}
                      </p>
                    )}
                  </fieldset>
                )}

                {schedule.kind === "monthly" && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cronjob-day-of-month" className={labelClass}>
                      {t("form.field.dayOfMonth")}
                    </label>
                    <select
                      id="cronjob-day-of-month"
                      className={inputClass}
                      value={schedule.dayOfMonth}
                      onChange={handleDayOfMonthChange}
                      disabled={isLoading}
                    >
                      {Array.from({ length: MAX_DAY_OF_MONTH }, (_, i) => i + 1).map(
                        (day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ),
                      )}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      {t("form.hint.dayOfMonth")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Resumen en lenguaje claro */}
            <p
              role="status"
              aria-live="polite"
              className="text-sm md:col-span-2"
            >
              <span className={labelClass}>{t("form.schedule.summaryLabel")}:</span>{" "}
              <span>{scheduleSummary}</span>
            </p>
          </div>


          {validationError && (
            <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {validationError}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            {t("form.button.cancel")}
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading
              ? t("form.button.saving")
              : isEditMode
                ? t("form.button.save")
                : t("form.button.create")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
