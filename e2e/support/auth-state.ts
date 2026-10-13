import path from 'node:path';

/**
 * Where the `setup` project saves the admin session. The directory is
 * git-ignored: it holds a live session cookie.
 */
export const AUTH_STATE_FILE = path.resolve(__dirname, '..', '.auth', 'admin.json');

/** Storage state with no cookies, for specs that must run signed out. */
export const SIGNED_OUT = { cookies: [], origins: [] };
