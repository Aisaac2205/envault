import { expect, test as setup } from '@playwright/test';
import { AUTH_STATE_FILE } from '../../support/auth-state';
import { adminCredentials, API_URL, BASE_URL } from '../../support/env';
import { STACK_READY_TIMEOUT_MS, waitForStack } from '../../support/stack';

// Better Auth allows 3 sign-in requests per 10 s per IP and the limit is
// hard-coded (no env knob). This is therefore the ONLY place that signs in:
// every other spec reuses the saved state and must never sign in again.
setup('sign in as the seeded admin and save the session', async ({ request }) => {
  setup.setTimeout(STACK_READY_TIMEOUT_MS + 30_000);

  // Read the credentials first so a missing .env.e2e fails at once, not after
  // the readiness wait.
  const { email, password } = adminCredentials();
  await waitForStack();

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
