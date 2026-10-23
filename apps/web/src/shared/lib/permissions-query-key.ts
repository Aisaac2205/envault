/**
 * Prefix of every cached answer of `GET /me/permissions`. The full key also
 * carries the user and the session (see `usePermissions`), so removing by this
 * prefix drops everyone's.
 */
export const PERMISSIONS_QUERY_KEY = ["permissions"] as const;
