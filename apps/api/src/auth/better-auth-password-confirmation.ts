import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.config';
import { PasswordConfirmation } from './password-confirmation';

/** The fields of Better Auth's APIError (from better-call) read here. */
interface BetterAuthApiError extends Error {
  name: 'APIError';
  statusCode: number;
}

// Better Auth's own isAPIError() also matches on the name; importing it from
// better-auth/api would add another ESM-only module to what Jest has to load.
function isBetterAuthApiError(error: unknown): error is BetterAuthApiError {
  return (
    error instanceof Error &&
    error.name === 'APIError' &&
    typeof (error as Partial<BetterAuthApiError>).statusCode === 'number'
  );
}

/**
 * Better Auth's server-only `verifyPassword` endpoint. It resolves the session
 * from the request headers again, from the database rather than a cookie
 * cache, so the password checked is always that of the user the request is
 * signed in as: a body cannot name another account.
 */
@Injectable()
export class BetterAuthPasswordConfirmation extends PasswordConfirmation {
  async verify(headers: IncomingHttpHeaders, password: string): Promise<boolean> {
    try {
      const result = await auth.api.verifyPassword({
        body: { password },
        headers: fromNodeHeaders(headers),
      });
      // Only an explicit `{ status: true }` confirms; any other answer is a
      // failed confirmation rather than a pass.
      return result?.status === true;
    } catch (error) {
      // 400 (INVALID_PASSWORD) is a wrong password. 401 means the session
      // ended after the guard let the request in. Anything else is a fault,
      // not an answer, and must not be counted as a failed confirmation.
      if (isBetterAuthApiError(error) && error.statusCode === 400) {
        return false;
      }
      if (isBetterAuthApiError(error) && error.statusCode === 401) {
        throw new UnauthorizedException('Session absent or expired');
      }
      throw error;
    }
  }
}
