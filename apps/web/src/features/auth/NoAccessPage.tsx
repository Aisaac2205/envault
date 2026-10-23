import { Navigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/shared/hooks/useAuth";
import { usePermissions } from "@/shared/hooks/usePermissions";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";

/**
 * Where a signed-in user lands when the server granted them no section at all.
 * Anyone who does have a section is sent to it instead, so the page cannot be
 * used as a dead end by mistake.
 */
export default function NoAccessPage() {
  const { t } = useTranslation("auth");
  const { logout } = useAuth();
  const { status, firstAllowedPath } = usePermissions();

  // Until the server has answered, "no access" would be a guess.
  if (status === "loading") {
    return null;
  }

  if (firstAllowedPath) {
    return <Navigate to={firstAllowedPath} replace />;
  }

  return (
    <div className="space-y-8 p-4 sm:p-6 lg:p-8">
      <PageHeader title={t("noAccess.page.title")} />
      <EmptyState
        icon={<ShieldOff />}
        title={t("noAccess.empty.title")}
        description={t("noAccess.empty.description")}
        action={
          <Button variant="outline" onClick={() => void logout()}>
            {t("action.logout", { ns: "common" })}
          </Button>
        }
      />
    </div>
  );
}
