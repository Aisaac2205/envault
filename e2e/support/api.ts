import type { APIRequestContext, APIResponse, PlaywrightWorkerArgs } from '@playwright/test';
import { SIGNED_OUT } from './auth-state';
import { adminCredentials, API_URL, BASE_URL, DIRECT_API_URL, type Credentials } from './env';
import { uniqueClientIp } from './unique';

/** The `playwright` worker fixture; the package does not export its type by name. */
export type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * A request context set up like the `api` project (base URL under `/api`, the
 * `Origin` header Better Auth demands) but independent of its saved admin
 * session. It starts signed out unless a storage state is given.
 */
export function newApiContext(
  playwright: PlaywrightApi,
  storageState: string | typeof SIGNED_OUT = SIGNED_OUT,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: `${API_URL}/`,
    extraHTTPHeaders: { Origin: BASE_URL },
    storageState,
  });
}

/**
 * Signs in on the API's own port instead of through the web proxy.
 *
 * Better Auth limits sign-ins to 3 per 10 s per client IP and `setup` already
 * spends one per run. Behind the proxy every client shares one address, because
 * nginx overwrites `X-Forwarded-For`; the direct port trusts the header, so a
 * unique value gives each sign-in a bucket of its own. The session cookie is
 * tied to the host name, not the port, so the context can use it on the proxy.
 */
export function signInOnDirectApi(
  context: APIRequestContext,
  credentials: Credentials,
  clientIp: string = uniqueClientIp(),
): Promise<APIResponse> {
  return context.post(`${DIRECT_API_URL}/api/auth/sign-in/email`, {
    headers: { 'X-Forwarded-For': clientIp },
    data: credentials,
  });
}

/** Throws with the response body when a step that a test only prepares failed. */
export async function assertOk(response: APIResponse, what: string): Promise<void> {
  if (!response.ok()) {
    throw new Error(`${what} failed: HTTP ${response.status()} ${await response.text()}`);
  }
}

/**
 * Deletes a connection as the seeded admin. A PROD connection takes the
 * step-up confirmation the API asks for (its exact name and the admin's
 * password); any other connection is deleted without a body.
 */
export function deleteConnection(
  api: APIRequestContext,
  connection: { id: string; name: string; environment: string },
): Promise<APIResponse> {
  const confirmation =
    connection.environment === 'prod'
      ? { data: { confirmName: connection.name, password: adminCredentials().password } }
      : undefined;
  return api.delete(`connections/${connection.id}`, confirmation);
}
