import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

/** The caption of a card whose figure could not be loaded, with the retry. */
export function KpiRetry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("dashboard");

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{t("kpi.error")}</span>
      <Button className="h-7 px-2 pointer-coarse:h-11 pointer-coarse:px-3" onClick={onRetry} size="sm" variant="outline">
        {t("kpi.retry")}
      </Button>
    </span>
  );
}
