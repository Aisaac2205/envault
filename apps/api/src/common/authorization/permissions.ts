/**
 * The single source of truth for who may use what.
 *
 * Every authorization decision in the system (the guard on each controller,
 * the `GET /me/permissions` endpoint the web app reads, and through it the
 * sidebar and the route guards) is derived from `PERMISSIONS`. There is no
 * second list to keep in step.
 *
 * Rules the rest of the code relies on:
 * - Default-deny. A feature that is not a key of `PERMISSIONS`, or a role that
 *   is not listed under a feature, gets no access.
 * - The server is authoritative. The web app only uses the map to decide what
 *   to show; the API enforces it on every request.
 *
 * To add a role (e.g. a read-only `viewer`): add it to `ROLES` and list it
 * under the features it may use. Nothing else changes in this file. Splitting
 * a feature into read and write access is a later, endpoint-level refinement
 * (a per-handler `@RequirePermission` overrides the class-level one).
 */

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Feature -> roles allowed to use it. Keys are named after the screen the
 * feature backs, and the controllers that feed that screen require the same
 * key. Declaration order is the order the endpoint reports them in.
 */
export const PERMISSIONS = {
  /** Home screen: job summary, statistics and daily series (`/jobs`, `/jobs/analytics`). */
  dashboard: ['admin'],
  /** Backups (`/backups`). */
  dumps: ['admin'],
  /** Restores, including their progress stream (`/restores`). */
  restore: ['admin'],
  /** Schedules (`/cronjobs`, `/backups/settings`). */
  cronjobs: ['admin'],
  /** Database connections (`/connections`). */
  connections: ['admin'],
  /** Storage cleanup, reconciliation and retention (`/maintenance`). */
  cleanup: ['admin'],
  /** Audit trail (`/audit`). */
  audit: ['admin'],
  /**
   * User management. Its endpoints belong to the Better Auth admin plugin,
   * which enforces its own `adminRoles` (default `['admin']`) on
   * `/api/auth/admin/*`; this entry drives what the web app offers.
   */
  users: ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Feature = keyof typeof PERMISSIONS;

export const FEATURES = Object.keys(PERMISSIONS) as Feature[];

/** The shape the lookups accept, so the same logic works on any map. */
export type PermissionMap = Readonly<Record<string, readonly string[]>>;

const hasOwn = (map: PermissionMap, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(map, key);

/** Narrows an arbitrary value to a feature of the map. */
export function isFeature(
  value: unknown,
  map: PermissionMap = PERMISSIONS,
): value is Feature {
  return typeof value === 'string' && hasOwn(map, value);
}

/**
 * Better Auth stores a user's role as one string that may hold several roles,
 * comma-separated (`"admin,user"`), and its own admin plugin splits on "," and
 * nothing else (`has-permission.mjs`). This does the same, so a role string
 * means the same thing to both: names are matched exactly, case and spaces
 * included, which means `"user, admin"` does not grant `admin`.
 */
export function parseRoles(role: string | undefined): string[] {
  return (role ?? '').split(',').filter((name) => name.length > 0);
}

/**
 * Whether the user's `role` string may use `feature`: true when ANY of the
 * roles in it is granted the feature. Default-deny: an unknown feature, an
 * unknown or missing role, and an inherited property name such as
 * `constructor` all answer `false`.
 */
export function canAccess(
  role: string | undefined,
  feature: string,
  map: PermissionMap = PERMISSIONS,
): boolean {
  if (!hasOwn(map, feature)) {
    return false;
  }
  const allowed = map[feature];
  return parseRoles(role).some((name) => allowed.includes(name));
}

/** Every feature any of the roles in `role` may use (their union), in declaration order. */
export function featuresForRole(
  role: string | undefined,
  map: PermissionMap = PERMISSIONS,
): string[] {
  return Object.keys(map).filter((feature) => canAccess(role, feature, map));
}
