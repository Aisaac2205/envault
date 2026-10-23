import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedOnly } from './authenticated-only.decorator';
import { Feature } from './permissions';
import { PermissionsGuard } from './permissions.guard';
import { Public } from './public.decorator';
import { RequirePermission } from './require-permission.decorator';

@RequirePermission('audit')
class ClassLevelAudit {
  handler(): void {}
}

class HandlerLevelOnly {
  @RequirePermission('cronjobs')
  guarded(): void {}

  unguarded(): void {}
}

@RequirePermission('audit')
class ClassWithOverride {
  @RequirePermission('cronjobs')
  override(): void {}
}

class Undecorated {
  handler(): void {}
}

@Public()
class PublicController {
  handler(): void {}
}

@AuthenticatedOnly()
class SessionOnlyController {
  handler(): void {}
}

@AuthenticatedOnly()
class SessionOnlyWithOneFeature {
  @RequirePermission('audit')
  strict(): void {}
}

const admin: AuthUser = { id: '1', email: 'a@x.test', name: 'A', role: 'admin' };
const regular: AuthUser = { id: '2', email: 'u@x.test', name: 'U', role: 'user' };
const viewer: AuthUser = { id: '3', email: 'v@x.test', name: 'V', role: 'viewer' };
const withRoles = (role: string): AuthUser => ({ ...regular, role });

function contextFor(
  target: new () => object,
  handler: () => void,
  user?: AuthUser,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  describe('class-level @RequirePermission', () => {
    const ctx = (user?: AuthUser) =>
      contextFor(ClassLevelAudit, ClassLevelAudit.prototype.handler, user);

    it('lets a role the map grants the feature to through', () => {
      expect(guard.canActivate(ctx(admin))).toBe(true);
    });

    it('rejects a role the map does not grant it to', () => {
      expect(() => guard.canActivate(ctx(regular))).toThrow('Insufficient permissions');
    });

    it('rejects a role the map does not know', () => {
      expect(() => guard.canActivate(ctx(viewer))).toThrow('Insufficient permissions');
    });

    it('rejects a request with no user', () => {
      expect(() => guard.canActivate(ctx(undefined))).toThrow('Insufficient permissions');
    });

    it('accepts a comma-separated role list when any role is granted', () => {
      expect(guard.canActivate(ctx(withRoles('admin,user')))).toBe(true);
    });

    it('does not trim the names, as Better Auth does not', () => {
      expect(() => guard.canActivate(ctx(withRoles(' admin')))).toThrow(
        'Insufficient permissions',
      );
      expect(() => guard.canActivate(ctx(withRoles('user, admin')))).toThrow(
        'Insufficient permissions',
      );
    });

    it('matches role names exactly', () => {
      expect(() => guard.canActivate(ctx(withRoles('Admin')))).toThrow(
        'Insufficient permissions',
      );
    });
  });

  describe('handler-level @RequirePermission', () => {
    it('is read from the handler when the class has none', () => {
      const ctx = contextFor(HandlerLevelOnly, HandlerLevelOnly.prototype.guarded, admin);

      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('takes precedence over the class-level feature', () => {
      const reflector = new Reflector();
      const spy = jest.spyOn(reflector, 'getAllAndOverride');
      const ctx = contextFor(ClassWithOverride, ClassWithOverride.prototype.override, admin);

      new PermissionsGuard(reflector).canActivate(ctx);

      expect(spy).toHaveBeenCalledWith('requiredPermission', expect.anything());
      expect(spy.mock.results.some((result) => result.value === 'cronjobs')).toBe(true);
    });
  });

  describe('default-deny', () => {
    it('rejects a handler that declares no feature, even for admin', () => {
      const ctx = contextFor(Undecorated, Undecorated.prototype.handler, admin);

      expect(() => guard.canActivate(ctx)).toThrow('Insufficient permissions');
    });

    it('rejects a sibling handler that was left undecorated', () => {
      const ctx = contextFor(HandlerLevelOnly, HandlerLevelOnly.prototype.unguarded, admin);

      expect(() => guard.canActivate(ctx)).toThrow('Insufficient permissions');
    });

    it('rejects a feature that is not in the map, even for admin', () => {
      class Typo {
        @RequirePermission('billing' as Feature)
        handler(): void {}
      }
      const ctx = contextFor(Typo, Typo.prototype.handler, admin);

      expect(() => guard.canActivate(ctx)).toThrow('Insufficient permissions');
    });
  });

  describe('@Public()', () => {
    it('lets a request with no user through', () => {
      const ctx = contextFor(PublicController, PublicController.prototype.handler);

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('@AuthenticatedOnly()', () => {
    const ctx = (user?: AuthUser) =>
      contextFor(SessionOnlyController, SessionOnlyController.prototype.handler, user);

    it.each([admin, regular, viewer])('lets any signed-in user ($user.role) through', (user) => {
      expect(guard.canActivate(ctx(user))).toBe(true);
    });

    it('still rejects a request with no user', () => {
      expect(() => guard.canActivate(ctx(undefined))).toThrow('Insufficient permissions');
    });

    it('yields to a feature declared on one handler of the same class', () => {
      const strict = contextFor(
        SessionOnlyWithOneFeature,
        SessionOnlyWithOneFeature.prototype.strict,
        regular,
      );

      expect(() => guard.canActivate(strict)).toThrow('Insufficient permissions');
    });
  });
});
