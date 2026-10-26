/// <reference types="jest" />
import { UnauthorizedException } from '@nestjs/common';
import { BetterAuthPasswordConfirmation } from './better-auth-password-confirmation';

// better-auth is ESM-only and this repo's Jest config does not transform
// node_modules, so the auth instance and the header helper are stand-ins.
const mockVerifyPassword = jest.fn();
jest.mock('./auth.config', () => ({
  auth: { api: { verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args) } },
}));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (headers: Record<string, string>) => new Headers(headers),
}));

// What Better Auth throws from a server-side endpoint call (better-call's APIError).
function apiError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { name: 'APIError', statusCode, body: { code, message: code } });
}

describe('BetterAuthPasswordConfirmation', () => {
  const confirmation = new BetterAuthPasswordConfirmation();
  const headers = { cookie: 'better-auth.session_token=session-of-admin' };

  beforeEach(() => {
    mockVerifyPassword.mockReset();
  });

  it('confirms the password through the session in the request headers', async () => {
    mockVerifyPassword.mockResolvedValue({ status: true });

    await expect(confirmation.verify(headers, 'admin-password')).resolves.toBe(true);

    expect(mockVerifyPassword).toHaveBeenCalledTimes(1);
    const [{ body, headers: sent }] = mockVerifyPassword.mock.calls[0];
    expect(body).toEqual({ password: 'admin-password' });
    expect((sent as Headers).get('cookie')).toBe(headers.cookie);
  });

  it('reports a wrong password as not confirmed', async () => {
    mockVerifyPassword.mockRejectedValue(apiError(400, 'INVALID_PASSWORD'));

    await expect(confirmation.verify(headers, 'wrong')).resolves.toBe(false);
  });

  // Only Better Auth's explicit `{ status: true }` confirms the password.
  it.each([
    ['status false', { status: false }],
    ['no status', {}],
    ['no result', undefined],
  ])('does not confirm a result with %s', async (_case, result) => {
    mockVerifyPassword.mockResolvedValue(result);

    await expect(confirmation.verify(headers, 'admin-password')).resolves.toBe(false);
  });

  it('answers 401 when the session is gone', async () => {
    mockVerifyPassword.mockRejectedValue(apiError(401, 'UNAUTHORIZED'));

    await expect(confirmation.verify(headers, 'admin-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['another Better Auth error', apiError(500, 'FAILED_TO_GET_SESSION')],
    ['an unexpected error', new Error('connect ECONNREFUSED')],
  ])('lets %s through instead of calling it a wrong password', async (_case, error) => {
    mockVerifyPassword.mockRejectedValue(error);

    await expect(confirmation.verify(headers, 'admin-password')).rejects.toBe(error);
  });
});
