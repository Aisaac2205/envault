import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import {
  AUTHENTICATED_ONLY_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
  PermissionsGuard,
} from '../../common/authorization';
import { AuditController } from './audit.controller';

// Regression guard for the audit trail: AuditController once had
// BetterAuthGuard but no role guard, so any authenticated non-admin could read
// it. These run the real PermissionsGuard against the real controller's own
// metadata, so removing the feature declaration, or opting the controller out
// of the global guards, fails here.

function buildContext(handler: (...args: never[]) => unknown, user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => AuditController,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuditController access control', () => {
  const guard = new PermissionsGuard(new Reflector());
  const routes = [
    ['getLogs', AuditController.prototype.getLogs],
    ['getLogById', AuditController.prototype.getLogById],
  ] as const;

  it('belongs to the audit feature', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, AuditController)).toBe('audit');
  });

  it('stays behind the global guards (neither public nor session-only)', () => {
    expect(Reflect.getMetadata(PUBLIC_KEY, AuditController)).toBeUndefined();
    expect(Reflect.getMetadata(AUTHENTICATED_ONLY_KEY, AuditController)).toBeUndefined();
  });

  describe.each(routes)('%s', (_name, handler) => {
    it('rejects an authenticated non-admin user', () => {
      const context = buildContext(handler, {
        id: '1',
        email: 'user@example.com',
        name: 'User',
        role: 'user',
      });

      expect(() => guard.canActivate(context)).toThrow('Insufficient permissions');
    });

    it('rejects a request with no user at all', () => {
      expect(() => guard.canActivate(buildContext(handler, undefined))).toThrow(
        'Insufficient permissions',
      );
    });

    it('allows an admin user through', () => {
      const context = buildContext(handler, {
        id: '2',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
      });

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
