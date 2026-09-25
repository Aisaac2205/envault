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
import {
  useCronjobForm,
  CRON_PRESETS,
} from "../hooks/useCronjobForm";

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
                          disambiguator = ` — ${conn.host}/${conn.database}`;
                        } else if (conn.database) {
                          disambiguator = ` — ${conn.database}`;
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
                value={selectedPresetLabel}
                onChange={handlePresetChange}
                disabled={isLoading}
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
                    {t(`preset.${p.frequency}`)}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {t("form.frequencyNote")}
                {" "}(<code className="font-mono">{formData.frequency}</code>).
              </p>
            </div>

            {/* Expresión Cron */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="cronjob-expression"
                className="text-xs font-semibold text-muted-foreground"
              >
                {t("form.field.expression")}
              </label>
              <input
                id="cronjob-expression"
                className={`font-mono text-xs ${inputClass}`}
                type="text"
                name="cronExpression"
                value={formData.cronExpression}
                onChange={handleCronExpressionChange}
                placeholder="0 2 * * *"
                disabled={isLoading || !isCustom}
              />
              {!isCustom && (
                <p className="text-[11px] text-muted-foreground">
                  {t("form.customNote")}
                </p>
              )}
            </div>
          </div>

          {/* Cron helper text */}
          <div className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
            0 2 * * * = {t("form.cronHint.daily")}
            <br />
            0 2 * * 1 = {t("form.cronHint.weekly")}
            <br />
            0 */6 * * * = {t("form.cronHint.every6h")}
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
