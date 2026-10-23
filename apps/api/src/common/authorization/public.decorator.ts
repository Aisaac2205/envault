import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublicRoute';

/**
 * Opts a controller (or a single handler) out of authentication and
 * authorization. Everything is denied by default, so this is the only way to
 * serve a route without a session; `permission-coverage.spec.ts` keeps an
 * explicit list of the controllers allowed to use it.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
