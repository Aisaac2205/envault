import { Loader2, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useDbHygienePanel } from "../hooks/useMaintenance";

const inputClass =
  "h-9 w-20 rounded-md border border-input bg-background px-3 text-center text-sm tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function DbHygienePanel() {
  const { t } = useTranslation("cleanup");
  const {
    days,
    setDays,
    confirmOpen,
    setConfirmOpen,
    valid,
    daysNum,
    previewError,
    previewErrorDetail,
    count,
    handleConfirm,
    statusText,
    isPending,
  } = useDbHygienePanel();

  return (
    <Card variant="outlined">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t("hygiene.title")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("hygiene.description")}
          </p>
        </div>

        {previewError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {previewErrorDetail instanceof Error
              ? previewErrorDetail.message
              : t("hygiene.errorPreview")}
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-3">
            {/* Inline sentence control */}
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              <span className="text-muted-foreground">{t("hygiene.sentence1")}</span>
              <label htmlFor="db-hygiene-days" className="sr-only">
                {t("hygiene.srDaysLabel")}
              </label>
              <input
                id="db-hygiene-days"
                className={inputClass}
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-describedby="db-hygiene-status"
              />
              <span className="text-muted-foreground">{t("hygiene.sentence2")}</span>
            </div>

            {/* Status line */}
            <p
              id="db-hygiene-status"
              aria-live="polite"
              className={`text-xs ${
                !valid || count === 0
                  ? "text-muted-foreground"
                  : "font-medium text-destructive"
              }`}
            >
              {statusText}
            </p>
          </div>

          <Button
            type="button"
            variant="destructive"
            disabled={!valid || count === 0 || isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {isPending ? t("hygiene.deleting") : t("hygiene.delete")}
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle
                className="size-5 text-destructive"
                aria-hidden="true"
              />
              {t("hygiene.confirm.title")}
            </DialogTitle>
            <DialogDescription>
              {t("hygiene.confirm.description", { count, days: valid ? daysNum : "?" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              {t("hygiene.confirm.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending && (
                <Loader2 className="animate-spin" aria-hidden="true" />
              )}
              {t("hygiene.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
