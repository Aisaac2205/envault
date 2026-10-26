import type { IncomingHttpHeaders } from 'http';

/**
 * Checks the password of the user a request is signed in as, for actions that
 * ask for it again on top of the session (step-up confirmation).
 *
 * Declared without Better Auth so that the services depending on it load in
 * Jest, whose config does not transform the ESM-only `better-auth` packages.
 * AuthModule binds it to {@link BetterAuthPasswordConfirmation}.
 */
export abstract class PasswordConfirmation {
  /**
   * Resolves `true` when `password` is the current password of the session in
   * `headers`, `false` when it is not. Throws when there is no session.
   */
  abstract verify(headers: IncomingHttpHeaders, password: string): Promise<boolean>;
}
