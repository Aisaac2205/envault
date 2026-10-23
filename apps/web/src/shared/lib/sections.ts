import type { ComponentType } from "react";
import {
  Clock,
  Database,
  FileText,
  LayoutDashboard,
  Link2,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import type { RouteKey } from "./lazy-routes";

export interface AppSection {
  /**
   * The feature of the API's permission map that unlocks this section
   * (`apps/api/src/common/authorization/permissions.ts`). The web app never
   * decides who may see a section: it asks `GET /me/permissions` and shows the
   * ones whose feature the server granted. An unknown feature is never shown.
   */
  feature: string;
  path: string;
  routeKey: RouteKey;
  /** `common` namespace key of the sidebar label. */
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

const SECTION_LIST = [
  { feature: "dashboard", path: "/", routeKey: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },
  { feature: "dumps", path: "/dumps", routeKey: "dumps", labelKey: "nav.dumps", icon: Database },
  { feature: "cleanup", path: "/cleanup", routeKey: "cleanup", labelKey: "nav.cleanup", icon: Trash2 },
  { feature: "restore", path: "/restore", routeKey: "restore", labelKey: "nav.restore", icon: RotateCcw },
  { feature: "cronjobs", path: "/cronjobs", routeKey: "cronjobs", labelKey: "nav.cronjobs", icon: Clock },
  { feature: "connections", path: "/connections", routeKey: "connections", labelKey: "nav.connections", icon: Link2 },
  { feature: "users", path: "/users", routeKey: "users", labelKey: "nav.users", icon: Users },
  { feature: "audit", path: "/audit", routeKey: "audit", labelKey: "nav.audit", icon: FileText },
] as const satisfies readonly AppSection[];

/** Every screen in the sidebar, in the order it is listed. */
export const APP_SECTIONS: readonly AppSection[] = SECTION_LIST;

/** The features the screens above need, for routes to name them with type safety. */
export type FeatureKey = (typeof SECTION_LIST)[number]["feature"];

/** Where a signed-in user with no visible section lands. */
export const NO_ACCESS_PATH = "/no-access";
