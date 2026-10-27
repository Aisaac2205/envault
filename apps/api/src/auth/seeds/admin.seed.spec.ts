import { Logger } from '@nestjs/common';
import { AdminSeedService } from './admin.seed';

// better-auth is ESM-only and this repo's Jest config does not transform
// node_modules, so the auth instance and its pool are stand-ins.
const mockSignUpEmail = jest.fn();
const mockQuery = jest.fn();
jest.mock('../auth.config', () => ({
  auth: { api: { signUpEmail: (...args: unknown[]) => mockSignUpEmail(...args) } },
  authPool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// What Better Auth throws from a server-side endpoint call (better-call's APIError).
function apiError(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    name: 'APIError',
    statusCode: 400,
    body: { code, message },
  });
}

describe('AdminSeedService', () => {
  const env = { ...process.env };
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    process.env.BETTER_AUTH_ADMIN_EMAIL = 'ops@example.com';
    process.env.BETTER_AUTH_ADMIN_PASSWORD = 'correct horse battery staple';
    mockSignUpEmail.mockReset();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('creates the admin and promotes it when the password is accepted', async () => {
    mockSignUpEmail.mockResolvedValue({ user: { id: 'admin-1' } });

    await new AdminSeedService().onApplicationBootstrap();

    expect(mockSignUpEmail).toHaveBeenCalledWith({
      body: { email: 'ops@example.com', password: 'correct horse battery staple', name: 'Admin' },
    });
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE "user"'), [
      'admin',
      'admin-1',
    ]);
    expect(log).toHaveBeenCalledWith('Default admin user created');
    expect(error).not.toHaveBeenCalled();
  });

  describe('a password the policy refuses', () => {
    const refusal = apiError(
      'PASSWORD_TOO_WEAK',
      'Password is too common or too easy to guess. Use a longer passphrase made of words that do not belong together.',
    );

    it('does not crash the boot and does not create or promote anything', async () => {
      mockSignUpEmail.mockRejectedValue(refusal);

      await expect(new AdminSeedService().onApplicationBootstrap()).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalledTimes(1); // only the "does the user exist" lookup
    });

    it('logs which setting is at fault and which rule it broke', async () => {
      mockSignUpEmail.mockRejectedValue(refusal);

      await new AdminSeedService().onApplicationBootstrap();

      expect(error).toHaveBeenCalledTimes(1);
      const [message] = error.mock.calls[0] as [string];
      expect(message).toContain('BETTER_AUTH_ADMIN_PASSWORD');
      expect(message).toContain('PASSWORD_TOO_WEAK');
      expect(message).toContain('too common');
      expect(message).toMatch(/no admin user was created/i);
    });

    it('says what the account is called, since the name is one of the rules', async () => {
      mockSignUpEmail.mockRejectedValue(
        apiError('PASSWORD_TOO_WEAK', "Password cannot contain the user's name."),
      );

      await new AdminSeedService().onApplicationBootstrap();

      const [message] = error.mock.calls[0] as [string];
      expect(message).toContain('"Admin"');
      expect(message).toContain('BETTER_AUTH_ADMIN_EMAIL');
    });

    it('never logs the password itself', async () => {
      process.env.BETTER_AUTH_ADMIN_PASSWORD = 'Welcome12345!';
      mockSignUpEmail.mockRejectedValue(refusal);

      await new AdminSeedService().onApplicationBootstrap();

      expect(JSON.stringify(error.mock.calls)).not.toContain('Welcome12345!');
    });

    it('is not mistaken for an existing admin, whatever the message says', async () => {
      mockSignUpEmail.mockRejectedValue(
        apiError('PASSWORD_TOO_WEAK', 'something unique that was already there'),
      );

      await new AdminSeedService().onApplicationBootstrap();

      expect(error).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalledWith('Admin user already exists — skipping seed');
    });
  });

  describe('other failures keep their behavior', () => {
    it('treats a duplicate user as an existing admin', async () => {
      mockSignUpEmail.mockRejectedValue(new Error('User already exists'));

      await new AdminSeedService().onApplicationBootstrap();

      expect(log).toHaveBeenCalledWith('Admin user already exists — skipping seed');
      expect(error).not.toHaveBeenCalled();
    });

    it('logs any other failure and keeps booting', async () => {
      mockSignUpEmail.mockRejectedValue(new Error('connection refused'));

      await expect(new AdminSeedService().onApplicationBootstrap()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith('Failed to seed admin user: connection refused');
    });

    it('leaves an existing admin untouched, whatever the password in the environment', async () => {
      process.env.BETTER_AUTH_ADMIN_PASSWORD = '12345678';
      mockQuery.mockResolvedValue({ rows: [{ id: 'admin-1', role: 'admin' }] });

      await new AdminSeedService().onApplicationBootstrap();

      expect(mockSignUpEmail).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('Admin user already exists — skipping seed');
      expect(error).not.toHaveBeenCalled();
    });

    it('promotes an existing non-admin user without touching the password', async () => {
      process.env.BETTER_AUTH_ADMIN_PASSWORD = '12345678';
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'user' }] });

      await new AdminSeedService().onApplicationBootstrap();

      expect(mockSignUpEmail).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE "user"'), [
        'admin',
        'user-1',
      ]);
    });

    it('skips quietly when the environment has no admin credentials', async () => {
      delete process.env.BETTER_AUTH_ADMIN_PASSWORD;

      await new AdminSeedService().onApplicationBootstrap();

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockSignUpEmail).not.toHaveBeenCalled();
    });
  });
});
