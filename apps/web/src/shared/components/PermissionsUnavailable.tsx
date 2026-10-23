import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";

interface PermissionsUnavailableProps {
  onRetry: () => void;
}

/**
 * Shown when the server could not tell us what the user may see. Nothing is
 * offered meanwhile: guessing would either hide screens the user may open or
 * show ones they may not. Retry and log out stay reachable.
 */
export function PermissionsUnavailable({ onRetry }: PermissionsUnavailableProps) {
  const { t } = useTranslation("common");
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <EmptyState
        icon={<ShieldAlert />}
        title={t("permissions.error.title")}
        description={t("permissions.error.description")}
        action={
          <>
            <Button onClick={onRetry}>{t("action.retry")}</Button>
            <Button variant="outline" onClick={() => logout().catch(() => undefined)}>
              {t("action.logout")}
            </Button>
          </>
        }
      />
    </div>
  );
}
