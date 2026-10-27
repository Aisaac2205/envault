import { createPasswordPolicyHook } from './password-policy-hook';

// better-auth is ESM-only and this repo's Jest config does not transform
// node_modules, so the pieces of `better-auth/api` the hook uses are stand-ins:
// a middleware is just its handler, the session comes from a mock, and an
// APIError carries what Better Auth's carries (status code, body with code and
// message).
const mockGetSessionFromCtx = jest.fn();
jest.mock('better-auth/api', () => ({
  createAuthMiddleware: (handler: unknown) => handler,
  getSessionFromCtx: (...args: unknown[]) => mockGetSessionFromCtx(...args),
  APIError: {
    from: (status: string, body: { code: string; message: string }) =>
      Object.assign(new Error(body.message), {
        name: 'APIError',
        status,
        statusCode: status === 'BAD_REQUEST' ? 400 : 500,
        body,
      }),
  },
}));

interface Account {
  id: string;
  email: string;
  name: string;
}

const ACCOUNT: Account = { id: 'user-1', email: 'isaac.flores@example.com', name: 'Isaac Flores' };
const STRONG = 'correct horse battery staple';

// Passwords that every flow must refuse (the acceptance list of the feature).
const WEAK_PASSWORDS: Array<[string, string]> = [
  ['a short password', '12345678'],
  ['a digit sequence', '123456789012'],
  ['a common word with digits', 'password1234'],
  ['a common word with a capital and a symbol', 'Welcome12345!'],
  ['one repeated character', 'aaaaaaaaaaaa'],
  ['a repeated block', 'abcabcabcabc'],
  ['the email local part', 'xk-isaac.flores-2749'],
  ['the display name', 'Isaac Flores 2749 sunrise'],
];

interface FakeState {
  users: Record<string, { email: string; name: string }>;
  verifications: Record<string, { value: string; expiresAt: Date }>;
  session: { user: { email: string; name: string } } | null;
}

function createFakeAuth(state: Partial<FakeState> = {}) {
  const findUserById = jest.fn(async (id: string) => state.users?.[id] ?? null);
  const findVerificationValue = jest.fn(
    async (identifier: string) => state.verifications?.[identifier] ?? null,
  );
  mockGetSessionFromCtx.mockResolvedValue(state.session ?? null);

  const hook = createPasswordPolicyHook() as unknown as (ctx: unknown) => Promise<void>;
  const run = (ctx: { path?: string; body?: unknown; query?: unknown; operationId?: string }) =>
    hook({ ...ctx, context: { internalAdapter: { findUserById, findVerificationValue } } });

  return { run, findUserById, findVerificationValue };
}

const IN_AN_HOUR = (): Date => new Date(Date.now() + 3_600_000);

interface Flow {
  name: string;
  state: Partial<FakeState>;
  ctx: (password: string) => { path?: string; body?: unknown; query?: unknown; operationId?: string };
}

const FLOWS: Flow[] = [
  {
    name: 'sign-up',
    state: {},
    ctx: (password) => ({
      path: '/sign-up/email',
      body: { email: ACCOUNT.email, name: ACCOUNT.name, password },
    }),
  },
  {
    name: 'admin create-user',
    state: {},
    ctx: (password) => ({
      path: '/admin/create-user',
      body: { email: ACCOUNT.email, name: ACCOUNT.name, password, role: 'user' },
    }),
  },
  {
    name: 'admin set-user-password',
    state: { users: { [ACCOUNT.id]: ACCOUNT } },
    ctx: (password) => ({
      path: '/admin/set-user-password',
      body: { userId: ACCOUNT.id, newPassword: password },
    }),
  },
  {
    name: 'change-password',
    state: { session: { user: ACCOUNT } },
    ctx: (password) => ({
      path: '/change-password',
      body: { currentPassword: 'the-old-one-123', newPassword: password },
    }),
  },
  {
    name: 'reset-password (token in the body)',
    state: {
      users: { [ACCOUNT.id]: ACCOUNT },
      verifications: { 'reset-password:tok-1': { value: ACCOUNT.id, expiresAt: IN_AN_HOUR() } },
    },
    ctx: (password) => ({
      path: '/reset-password',
      body: { token: 'tok-1', newPassword: password },
    }),
  },
  {
    name: 'reset-password (token in the query)',
    state: {
      users: { [ACCOUNT.id]: ACCOUNT },
      verifications: { 'reset-password:tok-1': { value: ACCOUNT.id, expiresAt: IN_AN_HOUR() } },
    },
    ctx: (password) => ({
      path: '/reset-password',
      query: { token: 'tok-1' },
      body: { newPassword: password },
    }),
  },
  {
    // setPassword is server-only: it has no path, which the hook sees as "/".
    name: 'set-password (server only)',
    state: { session: { user: ACCOUNT } },
    ctx: (password) => ({
      path: '/',
      operationId: 'setPassword',
      body: { newPassword: password },
    }),
  },
];

describe('createPasswordPolicyHook', () => {
  beforeEach(() => {
    mockGetSessionFromCtx.mockReset();
  });

  describe.each(FLOWS)('$name', ({ state, ctx }) => {
    it.each(WEAK_PASSWORDS)('refuses %s with 400 PASSWORD_TOO_WEAK', async (_case, password) => {
      const { run } = createFakeAuth(state);

      await expect(run(ctx(password))).rejects.toMatchObject({
        name: 'APIError',
        statusCode: 400,
        body: { code: 'PASSWORD_TOO_WEAK', message: expect.any(String) },
      });
    });

    it('names the broken rule in the message', async () => {
      const { run } = createFakeAuth(state);

      await expect(run(ctx('Welcome12345!'))).rejects.toMatchObject({
        message: expect.stringMatching(/too common/i),
      });
      await expect(run(ctx('12345678'))).rejects.toMatchObject({
        message: expect.stringMatching(/at least 12 characters/i),
      });
    });

    it('lets a strong passphrase through', async () => {
      const { run } = createFakeAuth(state);

      await expect(run(ctx(STRONG))).resolves.toBeUndefined();
    });
  });

  describe('what the account data comes from', () => {
    it('reads the email and name from the body of a sign-up', async () => {
      const { run } = createFakeAuth();

      await expect(
        run({
          path: '/sign-up/email',
          body: { email: 'jane.doe@example.com', name: 'Jane', password: 'xk-jane.doe-2749-zq' },
        }),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_TOO_WEAK' } });
    });

    it('looks the user up by id for an admin set-user-password', async () => {
      const { run, findUserById } = createFakeAuth({ users: { [ACCOUNT.id]: ACCOUNT } });

      await expect(
        run({
          path: '/admin/set-user-password',
          body: { userId: ACCOUNT.id, newPassword: 'xk-isaac.flores-2749' },
        }),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_TOO_WEAK' } });
      expect(findUserById).toHaveBeenCalledWith(ACCOUNT.id);
    });

    it('reads the signed-in user for a change-password', async () => {
      const { run } = createFakeAuth({ session: { user: ACCOUNT } });

      await expect(
        run({ path: '/change-password', body: { newPassword: 'xk-isaac.flores-2749' } }),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_TOO_WEAK' } });
      // The session is read without refreshing it or trusting a cookie cache.
      expect(mockGetSessionFromCtx).toHaveBeenCalledWith(expect.anything(), {
        disableCookieCache: true,
        disableRefresh: true,
      });
    });

    it('follows the reset token to its user', async () => {
      const { run, findVerificationValue, findUserById } = createFakeAuth({
        users: { [ACCOUNT.id]: ACCOUNT },
        verifications: { 'reset-password:tok-1': { value: ACCOUNT.id, expiresAt: IN_AN_HOUR() } },
      });

      await expect(
        run({ path: '/reset-password', body: { token: 'tok-1', newPassword: 'xk-isaac.flores-2749' } }),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_TOO_WEAK' } });
      expect(findVerificationValue).toHaveBeenCalledWith('reset-password:tok-1');
      expect(findUserById).toHaveBeenCalledWith(ACCOUNT.id);
    });

    it.each([
      [
        'a user that does not exist',
        { path: '/admin/set-user-password', body: { userId: 'ghost', newPassword: STRONG } },
        {},
      ],
      [
        'no signed-in session',
        { path: '/change-password', body: { newPassword: STRONG } },
        { session: null },
      ],
      [
        'an unknown reset token',
        { path: '/reset-password', body: { token: 'nope', newPassword: STRONG } },
        {},
      ],
      [
        'an expired reset token',
        { path: '/reset-password', body: { token: 'old', newPassword: STRONG } },
        {
          users: { [ACCOUNT.id]: ACCOUNT },
          verifications: {
            'reset-password:old': { value: ACCOUNT.id, expiresAt: new Date(Date.now() - 1000) },
          },
        },
      ],
      [
        'a reset request without a token',
        { path: '/reset-password', body: { newPassword: STRONG } },
        {},
      ],
    ])('still applies the account-free rules when there is %s', async (_case, ctx, state) => {
      const { run } = createFakeAuth(state as Partial<FakeState>);

      // Nothing to compare against: the endpoint answers the real problem.
      await expect(run(ctx)).resolves.toBeUndefined();
      await expect(run({ ...ctx, body: { ...(ctx.body as object), newPassword: '12345678' } })).rejects.toMatchObject({
        body: { code: 'PASSWORD_TOO_WEAK' },
      });
    });

    it('does not look anything up for a password that is weak by itself', async () => {
      const { run, findUserById, findVerificationValue } = createFakeAuth({
        users: { [ACCOUNT.id]: ACCOUNT },
        session: { user: ACCOUNT },
      });

      await expect(
        run({ path: '/admin/set-user-password', body: { userId: ACCOUNT.id, newPassword: '12345678' } }),
      ).rejects.toBeDefined();
      await expect(
        run({ path: '/change-password', body: { newPassword: '12345678' } }),
      ).rejects.toBeDefined();
      await expect(
        run({ path: '/reset-password', body: { token: 'tok-1', newPassword: '12345678' } }),
      ).rejects.toBeDefined();

      expect(findUserById).not.toHaveBeenCalled();
      expect(findVerificationValue).not.toHaveBeenCalled();
      expect(mockGetSessionFromCtx).not.toHaveBeenCalled();
    });
  });

  describe('requests it must leave alone', () => {
    // These verify or consume a password that already exists, or do not set one.
    it.each([
      ['password confirmation', '/verify-password', { password: '12345678' }],
      ['sign-in', '/sign-in/email', { email: ACCOUNT.email, password: '12345678' }],
      ['account deletion', '/delete-user', { password: '12345678' }],
      ['a role change', '/admin/set-role', { userId: ACCOUNT.id, role: 'admin' }],
      ['a profile update', '/update-user', { name: 'Isaac', password: '12345678' }],
      ['an admin user update', '/admin/update-user', { userId: ACCOUNT.id, data: { name: 'x' } }],
      ['a session read', '/get-session', undefined],
      ['a path that is not one of the flows', '/reset-password/some-token', { newPassword: '12345678' }],
    ])('ignores %s', async (_case, path, body) => {
      const { run, findUserById, findVerificationValue } = createFakeAuth({ session: { user: ACCOUNT } });

      await expect(run({ path, body })).resolves.toBeUndefined();

      expect(findUserById).not.toHaveBeenCalled();
      expect(findVerificationValue).not.toHaveBeenCalled();
      expect(mockGetSessionFromCtx).not.toHaveBeenCalled();
    });

    it('ignores the path "/" unless the operation is setPassword', async () => {
      const { run } = createFakeAuth({ session: { user: ACCOUNT } });

      await expect(run({ path: '/', body: { newPassword: '12345678' } })).resolves.toBeUndefined();
      await expect(
        run({ path: '/', operationId: 'somethingElse', body: { newPassword: '12345678' } }),
      ).resolves.toBeUndefined();
    });
  });

  describe('a password it cannot judge', () => {
    it.each([
      ['absent', { email: 'a@example.com', name: 'A' }],
      ['not a string', { email: 'a@example.com', name: 'A', password: 123456789012 }],
      ['a list', { email: 'a@example.com', name: 'A', password: ['12345678'] }],
    ])('passes a sign-up whose password is %s on to the endpoint, which validates the body', async (_case, body) => {
      const { run } = createFakeAuth();

      await expect(run({ path: '/sign-up/email', body })).resolves.toBeUndefined();
    });

    it('passes on a request with no body at all', async () => {
      const { run } = createFakeAuth();

      await expect(run({ path: '/change-password', body: undefined })).resolves.toBeUndefined();
    });

    it('accepts an admin create-user that sets no password (no credential account)', async () => {
      const { run } = createFakeAuth();

      await expect(
        run({ path: '/admin/create-user', body: { email: ACCOUNT.email, name: ACCOUNT.name } }),
      ).resolves.toBeUndefined();
      await expect(
        run({ path: '/admin/create-user', body: { email: ACCOUNT.email, name: ACCOUNT.name, password: '' } }),
      ).resolves.toBeUndefined();
    });

    it('refuses an empty password everywhere else', async () => {
      const { run } = createFakeAuth();

      await expect(
        run({ path: '/sign-up/email', body: { email: ACCOUNT.email, name: 'x', password: '' } }),
      ).rejects.toMatchObject({ body: { code: 'PASSWORD_TOO_WEAK' } });
    });
  });

  it('does not put the password in the error', async () => {
    const { run } = createFakeAuth();
    const password = 'Welcome12345!';

    const failure = await run({
      path: '/sign-up/email',
      body: { email: ACCOUNT.email, name: ACCOUNT.name, password },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    const visible = JSON.stringify({ ...(failure as object), message: (failure as Error).message });
    expect(visible).not.toContain(password);
  });
});
