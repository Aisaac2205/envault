import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { AUTHENTICATED_ONLY_KEY } from './authenticated-only.decorator';
import { canAccess } from './permissions';
import { PUBLIC_KEY } from './public.decorator';
import { PERMISSION_KEY } from './require-permission.decorator';

/**
 * Enforces the permission map on every route. It is registered globally, right
 * after `BetterAuthGuard`, which has already rejected anonymous requests with
 * 401 and put the user on the request.
 *
 * Default-deny: a handler that declares nothing is refused. The only ways out
 * are `@Public()` (skipped here and by the session guard), a feature the
 * caller's roles are granted (`@RequirePermission`), or `@AuthenticatedOnly()`
 * for a route every signed-in user may use. A feature wins over
 * `@AuthenticatedOnly()` when both are present.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, targets)) {
      return true;
    }

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser }>().user;

    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const feature = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY,
      targets,
    );

    if (feature) {
      if (canAccess(user.role, feature)) {
        return true;
      }
      throw new ForbiddenException('Insufficient permissions');
    }

    if (this.reflector.getAllAndOverride<boolean | undefined>(AUTHENTICATED_ONLY_KEY, targets)) {
      return true;
    }

    throw new ForbiddenException('Insufficient permissions');
  }
}
