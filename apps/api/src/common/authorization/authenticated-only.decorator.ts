import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ONLY_KEY = 'isAuthenticatedOnlyRoute';

/**
 * Marks a controller (or a single handler) that needs a session but belongs
 * to no feature of the permission map, because every signed-in user may use
 * it (for example reading their own permissions). A `@RequirePermission` on a
 * handler still wins over this marker on its class.
 */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
