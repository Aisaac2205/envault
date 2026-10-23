import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { PUBLIC_KEY } from '../common/authorization/public.decorator';
import { auth } from './auth.config';
import { AuthUser } from './decorators/current-user.decorator';

interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Registered globally (see `GLOBAL_AUTHORIZATION_GUARDS`): every route needs a
 * session unless it is marked `@Public()`.
 */
@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      throw new UnauthorizedException('Session absent or expired');
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: (session.user.role as string) ?? 'user',
    };

    return true;
  }
}
