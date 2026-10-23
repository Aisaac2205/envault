import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedOnly } from './authenticated-only.decorator';
import { featuresForRole } from './permissions';

export interface PermissionsResponse {
  /** The caller's role string, as the session reports it (it may list several roles). */
  role: string;
  /** Every feature the permission map grants to any of those roles. */
  features: string[];
}

/**
 * Tells the signed-in user what the permission map lets them use, so the web
 * app can build its navigation from the server's decision instead of keeping
 * a second copy of the rules. Any authenticated user may read their own
 * permissions, so it needs a session but no feature.
 */
@Controller('me')
@AuthenticatedOnly()
export class PermissionsController {
  @Get('permissions')
  getMine(@CurrentUser() user: AuthUser): PermissionsResponse {
    return {
      role: user.role,
      features: featuresForRole(user.role),
    };
  }
}
