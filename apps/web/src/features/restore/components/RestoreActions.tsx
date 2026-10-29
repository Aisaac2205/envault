import { Shield, Play, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

interface RestoreActionsProps {
  canSimulate: boolean;
  canExecute: boolean;
  isDryRun: boolean;
  isLoading: boolean;
  onSimulate: () => void;
  onExecute: () => void;
}

export function RestoreActions({
  canSimulate,
  canExecute,
  isDryRun,
  isLoading,
  onSimulate,
  onExecute,
}: RestoreActionsProps) {
  const { t } = useTranslation("restore");
  return (
    // The buttons follow the room this block has, not the viewport: side by
    // side they need about 425 px, more than the form column has on 1024-1536
    // px screens, where a viewport breakpoint pushed the second past the card.
    <div className="@container/actions space-y-3">
      {!isDryRun && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="leading-relaxed text-text-secondary">
            <span className="font-semibold text-destructive">
              {t("dryRun.warningPrefix", "Precaución")}.
            </span>{" "}
            {t("dryRun.warningText")}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 @[27rem]/actions:flex-row">
        <Button
          onClick={onSimulate}
          disabled={isLoading || !canSimulate || !isDryRun}
          className="@[27rem]/actions:flex-1"
          variant="outline"
        >
          <Play className="mr-2 h-4 w-4" />
          {isLoading && isDryRun ? t("action.processing") : t("action.simulate")}
        </Button>

        <Button
          onClick={onExecute}
          disabled={isLoading || !canExecute || isDryRun}
          variant="destructive"
          className="@[27rem]/actions:flex-1"
        >
          <AlertTriangle className="mr-2 h-4 w-4" />
          {isLoading && !isDryRun ? t("action.processing") : t("action.restore")}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-3.5 w-3.5 shrink-0" />
        <span>{t("action.recommendation")}</span>
      </div>
    </div>
  );
}
