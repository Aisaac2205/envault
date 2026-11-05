import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { auth } from './auth.config';
import { BetterAuthGuard } from './auth.guard';
import { SESSION_ABSOLUTE_TIMEOUT_MS } from './session-lifetime';

jest.mock('./auth.config', () => ({
  auth: { api: { getSession: jest.fn() } },
}));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: () => new Headers(),
}));

const getSession = auth.api.getSession as unknown as jest.Mock;

const user = { id: 'u1', email: 'u@x.test', name: 'U', role: 'admin' };

function contextWithHeaders(): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
  } as unknown as ExecutionContext;
}

function sessionCreatedAgo(ms: number) {
  return { user, session: { createdAt: new Date(Date.now() - ms) } };
}

describe('BetterAuthGuard', () => {
  const guard = new BetterAuthGuard(new Reflector());

  beforeEach(() => {
    getSession.mockReset();
  });

  it('lets a session younger than the absolute timeout through', async () => {
    getSession.mockResolvedValue(sessionCreatedAgo(SESSION_ABSOLUTE_TIMEOUT_MS - 60_000));

    await expect(guard.canActivate(contextWithHeaders())).resolves.toBe(true);
  });

  it('rejects a session that reached the absolute timeout, however recently it was used', async () => {
    getSession.mockResolvedValue(sessionCreatedAgo(SESSION_ABSOLUTE_TIMEOUT_MS));

    await expect(guard.canActivate(contextWithHeaders())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a request with no session', async () => {
    getSession.mockResolvedValue(null);

    await expect(guard.canActivate(contextWithHeaders())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
