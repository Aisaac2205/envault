import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test } from '../../support/fixtures';
import { uniqueEmail } from '../../support/unique';

// BetterAuthGuard and PermissionsGuard are global (default-deny), and every
// Nest controller that serves a screen declares @RequirePermission('<feature>').
// The feature maps to
// roles in apps/api/src/common/authorization/permissions.ts, where today only
// `admin` is granted any, so each row answers 401 without a session and 403
// for a signed-in user whose role is `user`. The guards run before body
// validation, which is why the write rows can be sent without a body and never
// change data.

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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
  { method: 'PUT', path: `backups/settings/${UNKNOWN_ID}` },
  { method: 'GET', path: 'maintenance/storage/overview' },
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

// GET /api/me/permissions is how the web app learns what to offer: the same
// permission map the guards above enforce, reported for the signed-in user.
// The list is pinned on purpose. Adding a feature (or a role that gets one) is
// a deliberate change to apps/api/src/common/authorization/permissions.ts and
// to the sidebar's sections in the web app, and this is where it is noticed.
const ALL_FEATURES = [
  'dashboard',
  'dumps',
  'restore',
  'cronjobs',
  'connections',
  'cleanup',
  'audit',
  'users',
];

test.describe('permissions of the signed-in user', () => {
  test('GET /me/permissions answers 401 without a session', async ({ anonymous }) => {
    await expectErrorEnvelope(await anonymous.get('me/permissions'), 401);
  });

  test('lists every feature for an admin', async ({ adminApi }) => {
    const permissions = await expectSuccessEnvelope(await adminApi.get('me/permissions'));

    expect(permissions).toEqual({ role: 'admin', features: ALL_FEATURES });
  });

  test('lists no feature for a user without the admin role', async ({ nonAdmin }) => {
    const permissions = await expectSuccessEnvelope(await nonAdmin.get('me/permissions'));

    expect(permissions).toEqual({ role: 'user', features: [] });
  });
});

// A well-formed body, so that the refusal can only come from the role check.
// The request is refused, so no user is created. The password has to satisfy
// the password policy too, which runs before the endpoint's own checks and
// would answer 400 instead of 401/403: it is neither a common password nor a
// pattern, and it contains neither the name nor the email below.
function validCreateUserBody() {
  return {
    email: uniqueEmail('refused'),
    password: 'correct-horse-battery-staple',
    name: 'Refused',
    role: 'user',
  };
}
