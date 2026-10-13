import { expectErrorEnvelope } from '../../support/envelope';
import { expect, test } from '../../support/fixtures';
import { uniqueEmail } from '../../support/unique';

// Every Nest controller in the API sits behind BetterAuthGuard + RolesGuard with
// @Roles('admin'), so each row answers 401 without a session and 403 for a
// signed-in user whose role is `user`. The guards run before body validation,
// which is why the write rows can be sent without a body and never change data.

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface Endpoint {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
}

const ADMIN_ONLY: Endpoint[] = [
  { method: 'GET', path: 'connections' },
  { method: 'POST', path: 'connections' },
  { method: 'POST', path: 'connections/test-raw' },
  { method: 'DELETE', path: `connections/${UNKNOWN_ID}` },
  { method: 'GET', path: 'backups' },
  { method: 'GET', path: 'backups/history' },
  { method: 'POST', path: 'backups' },
  { method: 'GET', path: 'restores' },
  { method: 'POST', path: 'restores' },
  { method: 'GET', path: 'jobs/summary' },
  { method: 'GET', path: 'jobs/stats' },
  { method: 'GET', path: 'jobs/analytics/daily' },
  { method: 'GET', path: 'audit' },
  { method: 'GET', path: 'cronjobs' },
];

// The user list belongs to the Better Auth admin plugin, which has its own
// guard and answers in its own format, not the API's error envelope.
const AUTH_ADMIN_ONLY: Endpoint[] = [
  { method: 'GET', path: 'auth/admin/list-users' },
  { method: 'POST', path: 'auth/admin/create-user' },
];

test.describe('anonymous client', () => {
  for (const { method, path } of ADMIN_ONLY) {
    test(`${method} /${path} answers 401`, async ({ anonymous }) => {
      await expectErrorEnvelope(await anonymous.fetch(path, { method }), 401);
    });
  }

  for (const { method, path } of AUTH_ADMIN_ONLY) {
    test(`${method} /${path} answers 401`, async ({ anonymous }) => {
      const response = await anonymous.fetch(path, {
        method,
        data: method === 'POST' ? validCreateUserBody() : undefined,
      });

      expect(response.status()).toBe(401);
    });
  }
});

test.describe('signed-in user without the admin role', () => {
  test('is really signed in, with the role user', async ({ nonAdmin }) => {
    const response = await nonAdmin.get('auth/get-session');

    expect(response.status()).toBe(200);
    expect((await response.json()).user.role).toBe('user');
  });

  for (const { method, path } of ADMIN_ONLY) {
    test(`${method} /${path} answers 403`, async ({ nonAdmin }) => {
      await expectErrorEnvelope(await nonAdmin.fetch(path, { method }), 403);
    });
  }

  for (const { method, path } of AUTH_ADMIN_ONLY) {
    test(`${method} /${path} answers 403`, async ({ nonAdmin }) => {
      const response = await nonAdmin.fetch(path, {
        method,
        data: method === 'POST' ? validCreateUserBody() : undefined,
      });

      expect(response.status()).toBe(403);
      expect(await response.json()).toEqual({
        message: expect.any(String),
        code: expect.any(String),
      });
    });
  }
});

// A well-formed body, so that the refusal can only come from the role check.
// The request is refused, so no user is created.
function validCreateUserBody() {
  return {
    email: uniqueEmail('refused'),
    password: 'refused-pass-123',
    name: 'Refused',
    role: 'user',
  };
}
