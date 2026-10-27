import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body of `DELETE /connections/:id`. A non-PROD connection is deleted without
 * one. A PROD connection needs both fields (security-model 1.1); they are
 * optional here because only the service knows the connection's environment,
 * and it refuses a PROD delete that leaves either out.
 */
export class DeleteConnectionDto {
  /** The exact name of the connection being deleted. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  confirmName?: string;

  /** The current password of the admin making the request. */
  @IsOptional()
  @IsString()
  // Better Auth's default maxPasswordLength: no valid password is longer.
  @MaxLength(128)
  password?: string;
}
