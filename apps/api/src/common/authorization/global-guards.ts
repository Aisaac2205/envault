import { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BetterAuthGuard } from '../../auth/auth.guard';
import { PermissionsGuard } from './permissions.guard';

/**
 * The guards that run on every route, in this order: the session first (401),
 * then the permission map (403). Registering them globally makes access denied
 * unless a route opts out with `@Public()` or `@AuthenticatedOnly()`, so a
 * controller written without any decorator is closed instead of open.
 *
 * AppModule spreads this list after the throttler. The order is a contract:
 * `PermissionsGuard` reads the user that `BetterAuthGuard` puts on the request.
 */
export const GLOBAL_AUTHORIZATION_GUARDS: Provider[] = [
  { provide: APP_GUARD, useClass: BetterAuthGuard },
  { provide: APP_GUARD, useClass: PermissionsGuard },
];
