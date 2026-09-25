import { Loader2, AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";
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
import { useReconcilePanel } from "../hooks/useMaintenance";

interface HealthRowProps {
  label: string;
  count: number;
  severity: "ok" | "warning" | "critical";
}

function HealthRow({ label, count, severity }: HealthRowProps) {
  const icon =
    severity === "ok" ? (
      <CheckCircle2 className="size-4 text-emerald-500" aria-hidden="true" />
    ) : severity === "warning" ? (
      <AlertCircle className="size-4 text-amber-500" aria-hidden="true" />
    ) : (
      <AlertTriangle
        className="size-4 text-destructive"
        aria-hidden="true"
      />
    );

  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm text-text-primary">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {count > 0 && (
          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
            <div
              className={`h-full rounded-full ${
                severity === "critical"
                  ? "bg-destructive"
                  : severity === "warning"
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(count * 10, 100)}%` }}
            />
          </div>
        )}
        <span
          className={`min-w-[2ch] text-right text-sm font-medium tabular-nums ${
            severity === "ok"
              ? "text-emerald-600"
              : severity === "warning"
                ? "text-amber-600"
                : "text-destructive"
          }`}
        >
          {count}
        </span>
      </div>
    </li>
  );
}

export function ReconcilePanel() {
  const { t } = useTranslation("cleanup");
  const {
    data,
    isLoading,
    isError,
    error,
    confirmOpen,
    setConfirmOpen,
    stale,
    manifests,
    junkDumps,
    restorable,
    toClean,
    handleConfirm,
    isPending,
  } = useReconcilePanel();

  if (isLoading) {
    return (
      <Card variant="outlined">
        <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t("reconcile.loading")}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card variant="outlined">
        <CardContent className="space-y-3 p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-text-primary">
            {t("reconcile.title")}
          </h3>
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {t("reconcile.errorAnalysis")}{" "}
            {error instanceof Error ? error.message : t("error.generic", { ns: "common" })}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card variant="outlined">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t("reconcile.title")}
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            {t("reconcile.description")}
          </p>
        </div>

        {toClean === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-4 py-3">
            <CheckCircle2
              className="size-5 text-emerald-600"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-text-primary">
              {t("reconcile.allSynced")}
            </span>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            <HealthRow
              label={t("reconcile.label.stale")}
              count={stale}
              severity={stale > 0 ? "critical" : "ok"}
            />
            <HealthRow
              label={t("reconcile.label.manifests")}
              count={manifests}
              severity={manifests > 0 ? "warning" : "ok"}
            />
            <HealthRow
              label={t("reconcile.label.junk")}
              count={junkDumps}
              severity={junkDumps > 0 ? "warning" : "ok"}
            />
            <HealthRow
              label={t("reconcile.label.restorable")}
              count={restorable}
              severity="ok"
            />
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <p
            aria-live="polite"
            role="status"
            className="text-xs text-muted-foreground"
          >
            {toClean === 0
              ? t("reconcile.statusNone")
              : t("reconcile.statusFound", { count: toClean })}
          </p>
          <Button
            type="button"
            variant="destructive"
            disabled={toClean === 0 || isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {isPending ? t("reconcile.cleaning") : t("reconcile.clean")}
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
              {t("reconcile.confirm.title")}
            </DialogTitle>
            <DialogDescription>
              {t("reconcile.confirm.description", { count: toClean })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              {t("reconcile.confirm.cancel")}
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
              {t("reconcile.confirm.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
