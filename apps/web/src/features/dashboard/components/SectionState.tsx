import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";

export type SectionStatus = "loading" | "error" | "empty" | "ready";

export interface SectionStateProps {
  status: SectionStatus;
  skeleton: ReactNode;
  empty?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}

/**
 * Status switch for one Section's surface. Each Section owns its own
 * loading/error/empty/ready state independently — a failing sibling never
 * blocks or hides this one (dashboard-page-shell "Independent Section States").
 */
export function SectionState({ status, skeleton, empty, onRetry, children }: SectionStateProps) {
  const { t } = useTranslation("dashboard");

  if (status === "loading") {
    return <>{skeleton}</>;
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 py-1 text-sm text-muted-foreground">
        <p>{t("state.error")}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("state.retry")}
          </Button>
        )}
      </div>
    );
  }

  if (status === "empty") {
    return <>{empty ?? null}</>;
  }

  return <>{children}</>;
}
