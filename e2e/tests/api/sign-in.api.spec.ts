import type { APIRequestContext } from '@playwright/test';
import { signInOnDirectApi } from '../../support/api';
import { expectErrorEnvelope } from '../../support/envelope';
import { adminCredentials } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { uniqueClientIp, uniqueEmail } from '../../support/unique';

// Better Auth owns /auth/*: its bodies are not wrapped in the API's data/error
// envelope. Sign-ins are the requests the limiter counts (3 per 10 s per client
// IP), so every one below goes to the direct API port with an IP of its own and
// never touches the bucket that `setup` uses. Nothing here signs out: that would
// revoke the admin session every other spec shares.

const WRONG_PASSWORD = 'not-the-password-123';

test.describe('sign-in', () => {
  test('rejects a wrong password without issuing a session', async ({ anonymous }) => {
    const response = await signInOnDirectApi(anonymous, {
      email: adminCredentials().email,
      password: WRONG_PASSWORD,
    });

    expect(response.status()).toBe(401);
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect(await response.json()).toEqual({
      message: expect.any(String),
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
  });

  test('rejects an unknown email without issuing a session', async ({ anonymous }) => {
    const response = await signInOnDirectApi(anonymous, {
      email: uniqueEmail('nobody'),
      password: WRONG_PASSWORD,
    });

    expect(response.status()).toBe(401);
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect(await response.json()).toEqual({
      message: expect.any(String),
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
  });

  test('does not reveal whether the email has an account', async ({ anonymous }) => {
    const unknownEmail = uniqueEmail('nobody');
    const knownAccount = await signInOnDirectApi(anonymous, {
      email: adminCredentials().email,
      password: WRONG_PASSWORD,
    });
    const unknownAccount = await signInOnDirectApi(anonymous, {
      email: unknownEmail,
      password: WRONG_PASSWORD,
    });

    expect(unknownAccount.status()).toBe(knownAccount.status());
    expect(await unknownAccount.json()).toEqual(await knownAccount.json());
    expect(await unknownAccount.text()).not.toContain(unknownEmail);
  });

  test('keeps public self-registration closed', async ({ anonymous }) => {
    const response = await anonymous.post('auth/sign-up/email', {
      data: { email: uniqueEmail('intruder'), password: 'intruder-pass-123', name: 'Intruder' },
    });

    expect(response.status()).toBe(403);
    expect(response.headers()['set-cookie']).toBeUndefined();
  });
});

test.describe('session', () => {
  test('returns the signed-in admin for the saved session', async ({ request }) => {
    const response = await request.get('auth/get-session');
    expect(response.status()).toBe(200);

    const { session, user } = await response.json();
    expect(user).toMatchObject({ email: adminCredentials().email, role: 'admin' });
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The session carries the token that authenticates it, so it must never be
    // handed a password hash as well.
    expect(JSON.stringify(user)).not.toMatch(/password/i);
  });

  test('returns null for an anonymous client', async ({ anonymous }) => {
    const response = await anonymous.get('auth/get-session');

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeNull();
  });

  test('treats a garbage session cookie as anonymous', async ({ anonymous }) => {
    const headers = { Cookie: 'better-auth.session_token=garbage.value' };

    const session = await anonymous.get('auth/get-session', { headers });
    expect(session.status()).toBe(200);
    expect(await session.json()).toBeNull();

    await expectErrorEnvelope(await anonymous.get('connections', { headers }), 401);
  });

  test('rejects a real session token whose signature was altered', async ({ request, anonymous }) => {
    const { cookies } = await request.storageState();
    const token = cookies.find((cookie) => cookie.name === 'better-auth.session_token');
    expect(token, 'the saved admin state has no session token').toBeDefined();

    const value = token!.value;
    const withCookie = (cookieValue: string) => ({
      Cookie: `better-auth.session_token=${cookieValue}`,
    });

    // Control: the untouched token, sent the same way, is accepted. Without it
    // a null answer below could just mean the header was never read.
    const accepted = await anonymous.get('auth/get-session', { headers: withCookie(value) });
    expect((await accepted.json()).user.email).toBe(adminCredentials().email);

    // Same token, last character of the signature changed.
    const tampered = withCookie(value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A'));
    const session = await anonymous.get('auth/get-session', { headers: tampered });
    expect(await session.json()).toBeNull();
    await expectErrorEnvelope(await anonymous.get('connections', { headers: tampered }), 401);
  });
});

// Regression guard for defect D3: the limiter is hard-coded (3 sign-ins per
// 10 s per IP, no env knob). If someone makes it configurable or removes it,
// this is the spec that notices.
test.describe('sign-in rate limit', () => {
  const attempt = (anonymous: APIRequestContext, clientIp: string) =>
    signInOnDirectApi(
      anonymous,
      { email: adminCredentials().email, password: WRONG_PASSWORD },
      clientIp,
    );

  test('answers 429 with a retry hint after 3 sign-ins in 10 seconds', async ({ anonymous }) => {
    const clientIp = uniqueClientIp();

    for (const n of [1, 2, 3]) {
      expect((await attempt(anonymous, clientIp)).status(), `sign-in ${n}`).toBe(401);
    }
    const blocked = await attempt(anonymous, clientIp);

    expect(blocked.status()).toBe(429);
    const retryAfter = Number(blocked.headers()['x-retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(10);
    expect(await blocked.json()).toEqual({ message: expect.stringMatching(/too many requests/i) });
  });

  // Also proves the direct port honours X-Forwarded-For: if it did not, every
  // sign-in in this suite would share one bucket and the other address would be
  // blocked too.
  test('counts per client IP, so another address is not blocked', async ({ anonymous }) => {
    const exhausted = uniqueClientIp();
    for (let n = 0; n < 4; n++) {
      await attempt(anonymous, exhausted);
    }

    const other = await attempt(anonymous, uniqueClientIp());
    expect(other.status()).toBe(401);
  });
});
