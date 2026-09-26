import { useState, useMemo } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trash2,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTimeShort as formatDate } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { useConnectionRetention } from "../hooks/useConnectionRetention";

interface RetentionDialogProps {
  connection: {
    slug: string;
    name: string;
    environment?: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_OPTIONS: { id: "7" | "14" | "30" | "90" | "unlimited"; labelKey: string }[] = [
  { id: "7", labelKey: "retention.preset.days_7" },
  { id: "14", labelKey: "retention.preset.days_14" },
  { id: "30", labelKey: "retention.preset.days_30" },
  { id: "90", labelKey: "retention.preset.days_90" },
  { id: "unlimited", labelKey: "retention.preset.unlimited" },
];

const inputClass =
  "h-9 w-20 rounded-md border border-input bg-background px-2.5 text-center text-xs tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function RetentionDialog({
  connection,
  open,
  onOpenChange,
}: RetentionDialogProps) {
  const { t } = useTranslation("cleanup");
  const connectionSlug = connection?.slug ?? "";

  const {
    rows,
    activePreset,
    applyPreset,
    updateRow,
    handleSave,
    handleRunCleanup,
    isDirty,
    hasSavedPolicy,
    preview,
    prunable,
    totalCount,
    totalMb,
    previewLoading,
    isSaving,
    isRunning,
    confirmOpen,
    setConfirmOpen,
    validationError,
    isLoading,
  } = useConnectionRetention(connectionSlug);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);

  const allCandidates = useMemo(() => {
    return preview.flatMap((p) => p.candidates ?? []);
  }, [preview]);

  const totalProtected = useMemo(() => {
    return preview.reduce((sum, p) => sum + (p.protectedCount ?? 0), 0);
  }, [preview]);

  if (!connection) return null;

  const onSaveClick = async () => {
    const success = await handleSave();
    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle className="text-base font-semibold text-text-primary">
                {t("retention.dialogTitle", { name: connection.name })}
              </DialogTitle>
              {connection.environment && (
                <Badge
                  variant={
                    connection.environment.toLowerCase() === "prod"
                      ? "default"
                      : "secondary"
                  }
                  className="text-[10px] uppercase tracking-wider"
                >
                  {connection.environment}
                </Badge>
              )}
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("retention.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Quick Presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-primary">
                  {t("retention.preset.label")}
                </label>
                {activePreset === "custom" && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {t("retention.preset.custom")}
                  </Badge>
                )}
                {hasSavedPolicy && !isDirty && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                    {t("retention.policyApplied")}
                  </span>
                )}
              </div>

              <div
                role="group"
                aria-label={t("retention.preset.label")}
                className="grid grid-cols-2 gap-2 sm:grid-cols-5"
              >
                {PRESET_OPTIONS.map((preset) => {
                  const isSelected = activePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={isLoading || isSaving}
                      onClick={() => applyPreset(preset.id)}
                      className={`flex h-9 items-center justify-center rounded-md border text-xs font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground shadow-xs"
                          : "border-border bg-card text-text-secondary hover:border-text-secondary/40 hover:bg-muted/50"
                      }`}
                    >
                      {t(preset.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Impact Projection (Simulación previa) */}
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">
                    {t("retention.impact.title")}
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-medium">
                    {t("retention.impact.badge")}
                  </Badge>
                </div>
                {previewLoading && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                    {t("retention.impact.calculating")}
                  </span>
                )}
              </div>

              <div className="text-xs">
                {prunable.length === 0 ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-1">
                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" aria-hidden="true" />
                    <span>{t("retention.impact.empty")}</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <p className="font-medium text-text-primary">
                        {t("retention.impact.total", {
                          count: totalCount,
                          mb: totalMb.toFixed(2),
                        })}
                      </p>
                      {totalProtected > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <ShieldCheck className="size-3.5" aria-hidden="true" />
                          {t("candidates.protectedCount", { count: totalProtected })}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {prunable.map((item) => (
                        <span
                          key={item.category}
                          className="inline-flex items-center gap-1 rounded bg-background/80 px-2 py-0.5 text-[11px] font-mono text-muted-foreground border border-border/60"
                        >
                          <span className="font-sans font-medium text-text-primary">
                            {t(`category.${item.category}`)}:
                          </span>
                          <span>{item.count}</span>
                          <span className="text-[10px] text-muted-foreground/80">
                            ({item.totalSizeMb.toFixed(1)} MB)
                          </span>
                        </span>
                      ))}
                    </div>

                    {allCandidates.length > 0 && (
                      <div className="pt-2 border-t border-border/40">
                        <button
                          type="button"
                          onClick={() => setShowCandidates((prev) => !prev)}
                          className="flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                        >
                          {showCandidates ? (
                            <>
                              <EyeOff className="size-3" aria-hidden="true" />
                              {t("candidates.hideDetails")}
                            </>
                          ) : (
                            <>
                              <Eye className="size-3" aria-hidden="true" />
                              {t("candidates.viewDetails")} ({allCandidates.length})
                            </>
                          )}
                        </button>

                        {showCandidates && (
                          <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-border/60 bg-background/80 p-2 space-y-1.5 text-[11px]">
                            {allCandidates.map((candidate, idx) => (
                              <div
                                key={candidate.fileKey || idx}
                                className="flex items-center justify-between gap-2 py-1 px-1.5 rounded hover:bg-muted/40 transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-mono text-text-primary text-[11px]" title={candidate.fileKey}>
                                    {candidate.fileKey.split("/").pop() || candidate.fileKey}
                                  </p>
                                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                    <span>{formatDate(candidate.lastModified)}</span>
                                    <span>-</span>
                                    <span>{(candidate.sizeBytes / (1024 * 1024)).toFixed(2)} MB</span>
                                  </div>
                                </div>
                                <div className="shrink-0">
                                  {candidate.isProtected ? (
                                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 flex items-center gap-1">
                                      <ShieldCheck className="size-3" aria-hidden="true" />
                                      {t(`reason.${candidate.reason}`, { defaultValue: candidate.reason })}
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300">
                                      {t(`reason.${candidate.reason}`, { defaultValue: candidate.reason })}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Advanced frequency breakdown (Progressive disclosure) */}
            <div className="border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="flex w-full items-center justify-between py-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                aria-expanded={showAdvanced}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3 text-muted-foreground" aria-hidden="true" />
                  {t("retention.advanced.toggle")}
                </span>
                {showAdvanced ? (
                  <ChevronUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    {t("retention.advanced.hint")}
                  </p>

                  <div className="divide-y divide-border/40 rounded-lg border border-border/80 bg-background">
                    {rows.map((row) => {
                      const valueId = `retention-days-${row.category}`;
                      const keepId = `retention-keep-${row.category}`;
                      return (
                        <div
                          key={row.category}
                          className="flex items-center justify-between px-3.5 py-2.5"
                        >
                          <label
                            htmlFor={valueId}
                            className="text-xs font-medium text-text-primary"
                          >
                            {t(`category.${row.category}`)}
                          </label>

                          <div className="flex items-center gap-3">
                            <label
                              htmlFor={keepId}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none"
                            >
                              <input
                                id={keepId}
                                type="checkbox"
                                checked={row.keepForever}
                                onChange={(e) =>
                                  updateRow(row.category, {
                                    keepForever: e.target.checked,
                                  })
                                }
                                disabled={isSaving}
                                className="rounded border-input text-primary focus:ring-1 focus:ring-ring"
                              />
                              {t("retention.keepForever")}
                            </label>

                            {!row.keepForever && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  id={valueId}
                                  className={inputClass}
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={row.days}
                                  onChange={(e) =>
                                    updateRow(row.category, {
                                      days: e.target.value,
                                    })
                                  }
                                  disabled={isSaving}
                                />
                                <span className="text-[11px] text-muted-foreground">
                                  {t("retention.days")}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {validationError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {validationError}
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-4">
            <div>
              {prunable.length > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isRunning || isSaving}
                  onClick={() => setConfirmOpen(true)}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="size-3.5 mr-1" aria-hidden="true" />
                  {t("retention.runNow")}
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 justify-end w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                {t("confirm.delete.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSaveClick}
                disabled={isLoading || isSaving || !isDirty}
              >
                {isSaving && (
                  <Loader2 className="size-3.5 animate-spin mr-1" aria-hidden="true" />
                )}
                {isSaving ? t("retention.saving") : t("retention.savePolicy")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Prune Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="size-5 text-destructive"
                aria-hidden="true"
              />
              {t("retention.confirm.title")}
            </DialogTitle>
            <DialogDescription>
              {t("retention.confirm.description")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isRunning}
            >
              {t("retention.confirm.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleRunCleanup()}
              disabled={isRunning}
            >
              {isRunning && (
                <Loader2 className="size-3.5 animate-spin mr-1" aria-hidden="true" />
              )}
              {t("retention.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
