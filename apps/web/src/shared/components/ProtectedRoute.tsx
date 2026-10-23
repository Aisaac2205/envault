import { useEffect, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { usePermissions } from "../hooks/usePermissions";
import { NO_ACCESS_PATH, type FeatureKey } from "../lib/sections";
import { GlobalLoadingOverlay } from "../ui/TetrominoLoader";
import { PermissionsUnavailable } from "./PermissionsUnavailable";

interface ProtectedRouteProps {
  children: ReactNode;
  /**
   * The feature of the API's permission map this route needs. Omit it for a
   * route any signed-in user may open (the not-found and no-access screens).
   */
  feature?: FeatureKey;
}

/**
 * The API refused the session itself, so the browser's copy of it is stale.
 * Ending it here, instead of just redirecting, matters: the login screen sends
 * a visitor with a session straight back to the app, which would loop.
 */
function EndStaleSession() {
  const { t } = useTranslation("common");
  const { logout } = useAuth();

  useEffect(() => {
    logout().catch(() => undefined);
  }, [logout]);

  return <GlobalLoadingOverlay open label={t("route.loading")} />;
}

export function ProtectedRoute({ children, feature }: ProtectedRouteProps) {
  const { t } = useTranslation("common");
  const { isAuthenticated, isInitializing } = useAuth();
  const permissions = usePermissions();

  // Until the session and the permissions are known, nothing but the loader is
  // rendered, so no section the user may not open is ever shown, not even for a
  // moment.
  if (isInitializing) {
    return <GlobalLoadingOverlay open label={t("route.loading")} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  switch (permissions.status) {
    case "loading":
      return <GlobalLoadingOverlay open label={t("route.loading")} />;
    case "unauthorized":
      return <EndStaleSession />;
    case "error":
      return <PermissionsUnavailable onRetry={permissions.refetch} />;
    case "ready":
      break;
  }

  if (feature && !permissions.can(feature)) {
    return <Navigate to={permissions.firstAllowedPath ?? NO_ACCESS_PATH} replace />;
  }

  return <>{children}</>;
}
