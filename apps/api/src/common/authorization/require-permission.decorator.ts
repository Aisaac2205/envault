import { SetMetadata } from '@nestjs/common';
import { Feature } from './permissions';

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Declares the feature a controller (or a single handler) belongs to. The
 * `PermissionsGuard` allows the request only if the permission map grants that
 * feature to the caller's role. A handler-level declaration overrides the
 * class-level one.
 */
export const RequirePermission = (feature: Feature) =>
  SetMetadata(PERMISSION_KEY, feature);
