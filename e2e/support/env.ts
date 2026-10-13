import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Settings shared by the Playwright config, the setup project and the specs.
 *
 * The values come from the repo-root `.env.e2e`, the same file that configures
 * the hermetic Docker stack, so the tests sign in with the admin account the
 * stack seeds. A variable already exported in the shell wins over the file,
 * which mirrors how Compose treats `--env-file`.
 */

const ENV_FILE = path.resolve(__dirname, '..', '..', '.env.e2e');

if (existsSync(ENV_FILE)) {
  // Never overwrites a variable that is already present in process.env.
  process.loadEnvFile(ENV_FILE);
}

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

// Always `localhost`, never 127.0.0.1: the session cookie is `Secure`, and
// Chromium and Playwright only send it over plain http to the hostname
// `localhost`.

/** Web app and API proxy: nginx serves the SPA and forwards `/api/*`. */
export const BASE_URL = withoutTrailingSlash(
  process.env.E2E_BASE_URL || 'http://localhost:5173',
);

/** API behind the web proxy, reached through `/api`. */
export const API_URL = `${BASE_URL}/api`;

/** API port published by the stack; the only place `/health` is served. */
export const DIRECT_API_URL = withoutTrailingSlash(
  process.env.E2E_DIRECT_API_URL || 'http://localhost:3000',
);

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Admin account the stack seeds at boot, read from the same variables so the
 * tests can never drift from the stack. Resolved lazily so that listing or
 * type-checking the suite does not require `.env.e2e`.
 */
export function adminCredentials(): Credentials {
  return {
    email: requiredVar('BETTER_AUTH_ADMIN_EMAIL'),
    password: requiredVar('BETTER_AUTH_ADMIN_PASSWORD'),
  };
}

function requiredVar(name: string): string {
  const value = process.env[name];
  if (value) {
    return value;
  }

  const hint = existsSync(ENV_FILE)
    ? `${name} is not set in ${ENV_FILE}. Compare the file with .env.e2e.example.`
    : `${ENV_FILE} does not exist. Copy .env.e2e.example to .env.e2e and run \`pnpm docker:e2e\`.`;
  throw new Error(`E2E configuration is incomplete: ${hint}`);
}
