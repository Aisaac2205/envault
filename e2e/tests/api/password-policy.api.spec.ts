import type { APIRequestContext, APIResponse } from '@playwright/test';
import { assertOk, newApiContext, signInOnDirectApi } from '../../support/api';
import { DIRECT_API_URL, type Credentials } from '../../support/env';
import { expect, test as base } from '../../support/fixtures';
import { uniqueClientIp, uniqueEmail } from '../../support/unique';

// Every flow that sets a NEW password refuses a weak one on the server, with
// HTTP 400, the stable code PASSWORD_TOO_WEAK and a message that names the
// rule it broke (apps/api/src/auth/password-policy). The web form only hints at
// the rule; this is the check that cannot be skipped by calling the API.
//
// Better Auth owns /auth/*, so the body is its own `{ message, code }`, not the
// API's error envelope.
//
// What can be driven through the stack, and so is covered here:
//   admin create-user         POST /auth/admin/create-user         (admin session)
//   admin set-user-password   POST /auth/admin/set-user-password   (admin session)
//   change-password           POST /auth/change-password           (the user's own session)
// What cannot, and is covered by the unit specs with the real endpoint paths:
//   sign-up         closed over HTTP (403, see sign-in.api.spec.ts); the seed calls it in-process
//   reset-password  needs an email delivery this stack does not have
//   set-password    server-only: it has no URL
// Checking a password that already exists is not part of the policy: sign-in
// and verify-password must keep answering "wrong password", never "too weak".
//
// Every request goes to the direct API port with a client IP of its own (see
// `betterAuth` below and signInOnDirectApi in support/api.ts): Better Auth
// limits change-password and the sign-ins to 3 per 10 s per client IP and path,
// and behind the proxy every client shares one address. Every user a test
// creates is removed when it ends, by email, so a user that a broken policy let
// through is removed too.

const PASSPHRASE = 'correct horse battery staple';
const NEW_PASSPHRASE = 'purple giraffe dances quietly';

interface WeakPassword {
  label: string;
  password: string;
  /** Part of the message that names the broken rule. */
  message: RegExp;
}

const WEAK_PASSWORDS: WeakPassword[] = [
  { label: 'a short password', password: '12345678', message: /at least 12 characters/i },
  { label: 'a digit sequence', password: '123456789012', message: /sequence/i },
  { label: 'a common word followed by digits', password: 'password1234', message: /too common/i },
  {
    label: 'a capitalised common word with digits and a symbol',
    password: 'Welcome12345!',
    message: /too common/i,
  },
  {
    label: 'one repeated character',
    password: 'aaaaaaaaaaaa',
    message: /single character repeated/i,
  },
  { label: 'a repeated block', password: 'abcabcabcabc', message: /block of characters repeated/i },
  { label: 'a keyboard walk', password: 'qwertyuiopas', message: /keyboard pattern/i },
];

interface Account extends Credentials {
  id: string;
  name: string;
}

interface Accounts {
  /** Creates a user whose password satisfies the policy; removed when the test ends. */
  provision: (name?: string) => Promise<Account>;
  /**
   * Registers an email that the test creates or tries to create, and returns
   * it. Whoever owns it when the test ends is removed.
   */
  track: (email: string) => string;
}

interface PolicyFixtures {
  accounts: Accounts;
  /** A client signed in as the given user, disposed when the test ends. */
  signedInAs: (credentials: Credentials) => Promise<APIRequestContext>;
}

/**
 * Better Auth's own routes on the direct API port, each call from a client IP
 * that no other request has used. The session cookie belongs to the host name,
 * not the port, so a context signed in through the proxy works here too.
 */
function betterAuth(context: APIRequestContext) {
  const url = (path: string): string => `${DIRECT_API_URL}/api/auth/${path}`;
  const headers = (): Record<string, string> => ({ 'X-Forwarded-For': uniqueClientIp() });
  return {
    post: (path: string, data?: unknown): Promise<APIResponse> =>
      context.post(url(path), { headers: headers(), data }),
    get: (path: string, params: Record<string, string | number>): Promise<APIResponse> =>
      context.get(url(path), { headers: headers(), params }),
  };
}

const test = base.extend<PolicyFixtures>({
  accounts: async ({ adminApi }, use) => {
    const emails = new Set<string>();
    const track = (email: string): string => {
      emails.add(email);
      return email;
    };

    const provision = async (name = 'E2E password policy'): Promise<Account> => {
      const credentials = { email: track(uniqueEmail('policy')), password: PASSPHRASE };
      const response = await betterAuth(adminApi).post('admin/create-user', {
        ...credentials, name,
        role: 'user',
      });
      await assertOk(response, `Creating ${credentials.email}`);
      const { user } = await response.json();
      return { ...credentials, id: user.id, name };
    };

    await use({ provision, track });

    // Every removal is attempted before reporting, so one failure cannot hide
    // the users that come after it.
    const failures: string[] = [];
    for (const email of emails) {
      for (const id of await findUserIds(adminApi, email)) {
        const removed = await betterAuth(adminApi).post('admin/remove-user', { userId: id });
        if (!removed.ok()) {
          failures.push(`${email} (HTTP ${removed.status()})`);
        }
      }
    }
    expect(failures, 'Users left behind by the test').toEqual([]);
  },

  signedInAs: async ({ playwright }, use) => {
    const contexts: APIRequestContext[] = [];

    await use(async (credentials) => {
      const context = await newApiContext(playwright);
      contexts.push(context);
      await assertOk(await signIn(context, credentials), `Signing in as ${credentials.email}`);
      return context;
    });

    await Promise.all(contexts.map((context) => context.dispose()));
  },
});

/** Ids of the users whose email is `email`, through the admin plugin's list. */
async function findUserIds(adminApi: APIRequestContext, email: string): Promise<string[]> {
  const response = await betterAuth(adminApi).get('admin/list-users', {
    searchField: 'email',
    searchValue: email,
    searchOperator: 'contains',
    limit: 10,
  });
  await assertOk(response, `Looking up ${email}`);
  const { users }: { users: Array<{ id: string; email: string }> } = await response.json();
  return users.filter((user) => user.email === email).map((user) => user.id);
}

async function expectTooWeak(response: APIResponse, message: RegExp): Promise<void> {
  expect(response.status(), await response.text()).toBe(400);
  // toEqual rejects extra keys, so nothing but the code and the message is exposed.
  expect(await response.json()).toEqual({
    code: 'PASSWORD_TOO_WEAK',
    message: expect.stringMatching(message),
  });
}

/** Signs in with the email and password only: an Account also carries an id and a name. */
function signIn(client: APIRequestContext, { email, password }: Credentials): Promise<APIResponse> {
  return signInOnDirectApi(client, { email, password });
}

test.describe('admin create-user', () => {
  for (const { label, password, message } of WEAK_PASSWORDS) {
    test(`refuses ${label}`, async ({ adminApi, accounts }) => {
      const email = accounts.track(uniqueEmail('weak'));

      const response = await betterAuth(adminApi).post('admin/create-user', {
        email,
        password,
        name: 'E2E weak password',
        role: 'user',
      });

      await expectTooWeak(response, message);
      expect(await findUserIds(adminApi, email), 'the refused user must not exist').toEqual([]);
    });
  }

  test('refuses a password that contains the email local part', async ({ adminApi, accounts }) => {
    const email = accounts.track(uniqueEmail('weak'));
    const localPart = email.split('@')[0];

    const response = await betterAuth(adminApi).post('admin/create-user', {
      email,
      password: `xk-${localPart}-2749`,
      name: 'E2E weak password',
      role: 'user',
    });

    await expectTooWeak(response, /email address/i);
    expect(await findUserIds(adminApi, email)).toEqual([]);
  });

  test('refuses a password that contains the display name', async ({ adminApi, accounts }) => {
    const email = accounts.track(uniqueEmail('weak'));

    const response = await betterAuth(adminApi).post('admin/create-user', {
      email,
      password: 'maple-orchard-lantern-9',
      name: 'Maple Orchard',
      role: 'user',
    });

    await expectTooWeak(response, /name/i);
    expect(await findUserIds(adminApi, email)).toEqual([]);
  });

  test('accepts a passphrase, and the new user signs in with it', async ({
    adminApi,
    accounts,
    anonymous,
  }) => {
    const credentials = { email: accounts.track(uniqueEmail('strong')), password: PASSPHRASE };

    const response = await betterAuth(adminApi).post('admin/create-user', {
      ...credentials,
      name: 'E2E strong password',
      role: 'user',
    });

    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).user).toMatchObject({ email: credentials.email, role: 'user' });
    await assertOk(await signIn(anonymous, credentials), 'Signing in with the passphrase');
  });
});

test.describe('admin set-user-password', () => {
  for (const { label, password, message } of WEAK_PASSWORDS) {
    test(`refuses ${label} and leaves the password as it was`, async ({
      adminApi,
      accounts,
      anonymous,
    }) => {
      const user = await accounts.provision();

      const response = await betterAuth(adminApi).post('admin/set-user-password', {
        userId: user.id,
        newPassword: password,
      });

      await expectTooWeak(response, message);
      await assertOk(await signIn(anonymous, user), 'Signing in with the unchanged password');
    });
  }

  test('refuses a password that contains the display name of that user', async ({
    adminApi,
    accounts,
  }) => {
    // The request names the user by id only: the API has to look the name up.
    const user = await accounts.provision('Walnut Harbor');

    const response = await betterAuth(adminApi).post('admin/set-user-password', {
      userId: user.id,
      newPassword: 'walnut-harbor-lantern-9',
    });

    await expectTooWeak(response, /name/i);
  });

  test('accepts a passphrase: the new password signs in, the old one no longer does', async ({
    adminApi,
    accounts,
    anonymous,
  }) => {
    const user = await accounts.provision();

    const response = await betterAuth(adminApi).post('admin/set-user-password', {
      userId: user.id,
      newPassword: NEW_PASSPHRASE,
    });

    expect(response.status(), await response.text()).toBe(200);
    await assertOk(
      await signIn(anonymous, { email: user.email, password: NEW_PASSPHRASE }),
      'Signing in with the new password',
    );
    expect((await signIn(anonymous, user)).status()).toBe(401);
  });
});

test.describe('change-password, by the signed-in user', () => {
  for (const { label, password, message } of WEAK_PASSWORDS) {
    test(`refuses ${label}`, async ({ accounts, signedInAs }) => {
      const user = await accounts.provision();
      const session = await signedInAs(user);

      const response = await betterAuth(session).post('change-password', {
        currentPassword: user.password,
        newPassword: password,
      });

      await expectTooWeak(response, message);
    });
  }

  test('refuses a password that contains the display name of the signed-in user', async ({
    accounts,
    signedInAs,
  }) => {
    // The request does not carry the name: the API reads it from the session.
    const user = await accounts.provision('Cedar Meadow');
    const session = await signedInAs(user);

    const response = await betterAuth(session).post('change-password', {
      currentPassword: user.password,
      newPassword: 'cedar-meadow-lantern-9',
    });

    await expectTooWeak(response, /name/i);
  });

  test('accepts a passphrase: the new password signs in, the old one no longer does', async ({
    accounts,
    signedInAs,
    anonymous,
  }) => {
    const user = await accounts.provision();
    const session = await signedInAs(user);

    const response = await betterAuth(session).post('change-password', {
      currentPassword: user.password,
      newPassword: NEW_PASSPHRASE,
    });

    expect(response.status(), await response.text()).toBe(200);
    await assertOk(
      await signIn(anonymous, { email: user.email, password: NEW_PASSPHRASE }),
      'Signing in with the new password',
    );
    expect((await signIn(anonymous, user)).status()).toBe(401);
  });
});

// The policy judges a password that is being SET. One that is only being
// checked is answered by the check that already existed, however weak it is.
test.describe('checking an existing password', () => {
  test('verify-password answers a weak guess as a wrong password', async ({ throwawayAdmin }) => {
    const response = await betterAuth(throwawayAdmin).post('verify-password', {
      password: '12345678',
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({
      code: 'INVALID_PASSWORD',
      message: expect.any(String),
    });
  });

  test('sign-in answers a weak password as invalid credentials', async ({ anonymous }) => {
    const response = await signIn(anonymous, {
      email: uniqueEmail('nobody'),
      password: '12345678',
    });

    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });
});
