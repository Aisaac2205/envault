import { existsSync } from 'node:fs';
import { expect, test as setup, type APIRequestContext } from '@playwright/test';
import type { PlaywrightApi } from '../../support/api';
import { AUTH_STATE_FILE } from '../../support/auth-state';
import { adminCredentials, API_URL, BASE_URL } from '../../support/env';
import { STACK_READY_TIMEOUT_MS, waitForStack } from '../../support/stack';

// Better Auth allows 3 sign-in requests per 10 s per IP and the limit is
// hard-coded (no env knob). This is therefore the only place that signs in
// through the web proxy, whose clients all share one IP, and it does so at
// most once per run. Specs that must sign in go to the direct API port with a
// client IP of their own (see support/api.ts).
setup('sign in as the seeded admin and save the session', async ({ playwright, request }) => {
  setup.setTimeout(STACK_READY_TIMEOUT_MS + 30_000);

  // Read the credentials first so a missing .env.e2e fails at once, not after
  // the readiness wait.
  const { email, password } = adminCredentials();
  await waitForStack();

  // Back-to-back runs would spend the shared allowance in seconds, so a saved
  // session that the API still accepts is kept instead of signing in again.
  if (await savedSessionIsValid(playwright, email)) {
    return;
  }

  const response = await request.post(`${API_URL}/auth/sign-in/email`, {
    headers: { Origin: BASE_URL },
    data: { email, password },
  });
  expect(
    response.status(),
    `Sign-in failed: ${await response.text()} ` +
      '(HTTP 429 means the limit of 3 sign-ins per 10 s was hit: wait 10 s and run again.)',
  ).toBe(200);

  const { cookies } = await request.storageState({ path: AUTH_STATE_FILE });
  expect(cookies.map((cookie) => cookie.name)).toContain('better-auth.session_token');
});

/**
 * Asks the API who the saved session belongs to. It is stale after
 * `pnpm docker:e2e:down` (the new database has never seen that session), after
 * its 7-day expiry, or when the admin account changed; the saved file can also
 * be missing or unreadable. All of those mean "sign in again".
 */
async function savedSessionIsValid(playwright: PlaywrightApi, adminEmail: string): Promise<boolean> {
  if (!existsSync(AUTH_STATE_FILE)) {
    return false;
  }

  let saved: APIRequestContext | undefined;
  try {
    saved = await playwright.request.newContext({
      storageState: AUTH_STATE_FILE,
      extraHTTPHeaders: { Origin: BASE_URL },
    });
    // disableCookieCache: the saved `session_data` cookie is signed with a secret
    // that survives a stack reset, so without this flag the API would answer from
    // the cookie for up to 5 minutes and call a session valid that its database
    // has never seen.
    const response = await saved.get(`${API_URL}/auth/get-session?disableCookieCache=true`);
    if (!response.ok()) {
      return false;
    }
    // The body is the literal `null` when the session is unknown.
    const session = await response.json();
    return session?.user?.email === adminEmail && session.user.role === 'admin';
  } catch {
    return false;
  } finally {
    await saved?.dispose();
  }
}
