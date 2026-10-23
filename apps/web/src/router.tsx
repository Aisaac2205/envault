import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "./shared/components/ProtectedRoute";
import { Layout } from "./shared/components/Layout";
import { GlobalLoadingOverlay } from "./shared/ui/TetrominoLoader";
import { useAuth } from "./shared/hooks/useAuth";
import { usePermissions } from "./shared/hooks/usePermissions";
import { NO_ACCESS_PATH, type FeatureKey } from "./shared/lib/sections";
import NotFound from "./features/not-found";
import {
  LazyDashboard,
  LazyDumps,
  LazyCleanup,
  LazyRestore,
  LazyCronjobs,
  LazyConnections,
  LazyAudit,
  LazyAuditDetail,
} from "./shared/lib/lazy-routes";

// eslint-disable-next-line react-refresh/only-export-components -- route-level lazy import, not a co-located constant
const LazyLoginPage = lazy(() => import("./features/auth/LoginPage"));
// eslint-disable-next-line react-refresh/only-export-components -- route-level lazy import, not a co-located constant
const LazyNoAccess = lazy(() => import("./features/auth/NoAccessPage"));
// eslint-disable-next-line react-refresh/only-export-components -- route-level lazy import, not a co-located constant
const LazyUsers = lazy(() => import("./features/users"));

// eslint-disable-next-line react-refresh/only-export-components -- route layout wrapper, not itself part of the router's public export
function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  // The sidebar offers what the server granted, the same answer the route
  // guards use; the web app keeps no list of its own.
  const { sections } = usePermissions();
  return (
    <Layout user={user} sections={sections} onLogout={logout}>
      <Suspense fallback={<GlobalLoadingOverlay open={true} />}>{children}</Suspense>
    </Layout>
  );
}

/**
 * A screen inside the app shell. `feature` is the entry of the API's
 * permission map the screen needs; leave it out for a screen every signed-in
 * user may open.
 */
function screen(element: ReactNode, feature?: FeatureKey) {
  return (
    <ProtectedRoute feature={feature}>
      <AuthenticatedLayout>{element}</AuthenticatedLayout>
    </ProtectedRoute>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/login",
    element: (
      <Suspense fallback={null}>
        <LazyLoginPage />
      </Suspense>
    ),
  },
  { path: "/", element: screen(<LazyDashboard />, "dashboard") },
  { path: "/dumps", element: screen(<LazyDumps />, "dumps") },
  { path: "/cleanup", element: screen(<LazyCleanup />, "cleanup") },
  { path: "/restore", element: screen(<LazyRestore />, "restore") },
  { path: "/cronjobs", element: screen(<LazyCronjobs />, "cronjobs") },
  { path: "/connections", element: screen(<LazyConnections />, "connections") },
  { path: "/users", element: screen(<LazyUsers />, "users") },
  { path: "/audit", element: screen(<LazyAudit />, "audit") },
  // An audit entry is part of the audit feature: whoever may not read the
  // trail may not open one entry of it either.
  { path: "/audit/:id", element: screen(<LazyAuditDetail />, "audit") },
  {
    // Where a user with no granted section lands (see ProtectedRoute). It names
    // no feature: it is the one screen every signed-in user may open.
    path: NO_ACCESS_PATH,
    element: screen(<LazyNoAccess />),
  },
  {
    // Anything the table above does not know. It sits behind the same guard as
    // every other address: a signed-in user sees the not-found screen inside
    // the app shell, a signed-out visitor is sent to the login screen.
    path: "*",
    element: screen(<NotFound />),
  },
];

export const router = createBrowserRouter(routes);
