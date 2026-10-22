import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "./shared/components/ProtectedRoute";
import { Layout } from "./shared/components/Layout";
import { GlobalLoadingOverlay } from "./shared/ui/TetrominoLoader";
import { useAuth } from "./shared/hooks/useAuth";
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
const LazyUsers = lazy(() => import("./features/users"));

// eslint-disable-next-line react-refresh/only-export-components -- route layout wrapper, not itself part of the router's public export
function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <Layout user={user} onLogout={logout}>
      <Suspense fallback={<GlobalLoadingOverlay open={true} />}>{children}</Suspense>
    </Layout>
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
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AuthenticatedLayout>
          <LazyDashboard />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/dumps",
    element: (
      <ProtectedRoute requiredRole="admin">
        <AuthenticatedLayout>
          <LazyDumps />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/cleanup",
    element: (
      <ProtectedRoute requiredRole="admin">
        <AuthenticatedLayout>
          <LazyCleanup />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/restore",
    element: (
      <ProtectedRoute>
        <AuthenticatedLayout>
          <LazyRestore />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/cronjobs",
    element: (
      <ProtectedRoute>
        <AuthenticatedLayout>
          <LazyCronjobs />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/connections",
    element: (
      <ProtectedRoute requiredRole="admin">
        <AuthenticatedLayout>
          <LazyConnections />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/users",
    element: (
      <ProtectedRoute requiredRole="admin">
        <AuthenticatedLayout>
          <LazyUsers />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/audit",
    element: (
      <ProtectedRoute>
        <AuthenticatedLayout>
          <LazyAudit />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    // GET /audit/:id is admin-only on the API (audit.controller.ts), so the
    // route guards to the same role rather than letting the page render and
    // then fail on a 403.
    path: "/audit/:id",
    element: (
      <ProtectedRoute requiredRole="admin">
        <AuthenticatedLayout>
          <LazyAuditDetail />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
  {
    // Anything the table above does not know. It sits behind the same guard as
    // every other address: a signed-in user sees the not-found screen inside
    // the app shell, a signed-out visitor is sent to the login screen.
    path: "*",
    element: (
      <ProtectedRoute>
        <AuthenticatedLayout>
          <NotFound />
        </AuthenticatedLayout>
      </ProtectedRoute>
    ),
  },
];

export const router = createBrowserRouter(routes);
