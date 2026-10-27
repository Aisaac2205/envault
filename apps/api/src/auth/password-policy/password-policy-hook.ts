import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import {
  PASSWORD_POLICY_ERROR_CODE,
  validatePassword,
  type PasswordPolicyContext,
} from './password-policy';

/** The context Better Auth hands to hooks and endpoints alike. */
type AuthContext = Parameters<typeof getSessionFromCtx>[0];

/**
 * A request that sets a NEW password. The paths are Better Auth's own,
 * verified against the installed version (1.7.10): `ctx.path` is the path the
 * endpoint is declared with, so a request cannot reach it under another
 * spelling. Anything not listed here is ignored on purpose: that is what
 * keeps `/verify-password`, `/sign-in/email` and `/delete-user`, which check a
 * password that already exists, out of the policy.
 */
interface PasswordFlow {
  /** The body field that carries the new password. */
  field: 'password' | 'newPassword';
  /**
   * A request without the password is valid. Only the admin create-user: with
   * no password (or an empty one) Better Auth creates the user without a
   * credential account, so there is nothing to judge.
   */
  optional?: boolean;
  /** Who the password is for, as far as the request lets us know. */
  account: (ctx: AuthContext) => Promise<PasswordPolicyContext>;
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Sign-up and admin create-user carry the account's email and name themselves. */
async function accountFromBody(ctx: AuthContext): Promise<PasswordPolicyContext> {
  return { email: readString(ctx.body, 'email'), name: readString(ctx.body, 'name') };
}

/** change-password and set-password act on the signed-in user. */
async function accountFromSession(ctx: AuthContext): Promise<PasswordPolicyContext> {
  // Neither refresh the session nor trust a cookie cache: this read only
  // needs the user's name and email, and the endpoint authenticates for real.
  const session = await getSessionFromCtx(ctx, { disableCookieCache: true, disableRefresh: true });
  return { email: session?.user.email, name: session?.user.name };
}

/** Admin set-user-password names the target user by id. */
async function accountFromUserId(ctx: AuthContext): Promise<PasswordPolicyContext> {
  const userId = readString(ctx.body, 'userId');
  if (!userId) return {};
  const user = await ctx.context.internalAdapter.findUserById(userId);
  return { email: user?.email, name: user?.name };
}

/** reset-password names the user through the single-use token. */
async function accountFromResetToken(ctx: AuthContext): Promise<PasswordPolicyContext> {
  const token = readString(ctx.body, 'token') ?? readString(ctx.query, 'token');
  if (!token) return {};
  const verification = await ctx.context.internalAdapter.findVerificationValue(
    `reset-password:${token}`,
  );
  if (!verification || verification.expiresAt < new Date()) return {};
  const user = await ctx.context.internalAdapter.findUserById(verification.value);
  return { email: user?.email, name: user?.name };
}

const FLOWS_BY_PATH: ReadonlyMap<string, PasswordFlow> = new Map<string, PasswordFlow>([
  ['/sign-up/email', { field: 'password', account: accountFromBody }],
  ['/admin/create-user', { field: 'password', optional: true, account: accountFromBody }],
  ['/admin/set-user-password', { field: 'newPassword', account: accountFromUserId }],
  ['/change-password', { field: 'newPassword', account: accountFromSession }],
  ['/reset-password', { field: 'newPassword', account: accountFromResetToken }],
]);

// `setPassword` is a server-only endpoint: it has no path and no URL, so the
// hook sees the middleware default "/" and can only tell it by its operation id.
const SET_PASSWORD_OPERATION_ID = 'setPassword';
const SET_PASSWORD_FLOW: PasswordFlow = { field: 'newPassword', account: accountFromSession };

function findFlow(ctx: AuthContext): PasswordFlow | undefined {
  const fromPath = FLOWS_BY_PATH.get(ctx.path);
  if (fromPath) return fromPath;
  const { operationId } = ctx as { operationId?: unknown };
  return operationId === SET_PASSWORD_OPERATION_ID ? SET_PASSWORD_FLOW : undefined;
}

/**
 * `hooks.before` for Better Auth: refuses a weak NEW password before the
 * endpoint runs, with HTTP 400 and the stable code `PASSWORD_TOO_WEAK`. Hooks
 * run for `auth.api.*` calls as well as HTTP requests, so the admin seed is
 * covered and gets the error thrown.
 */
export function createPasswordPolicyHook() {
  return createAuthMiddleware(async (ctx) => {
    const flow = findFlow(ctx);
    if (!flow) return;

    // The hook runs before the endpoint validates its body. Anything that is
    // not a string is left for that validation to answer.
    const password = readString(ctx.body, flow.field);
    if (password === undefined || (flow.optional && password === '')) return;

    // The rules that need no account data go first, so that a password that is
    // weak on its own costs no session or database read.
    let result = validatePassword(password);
    if (result.valid) {
      result = validatePassword(password, await flow.account(ctx));
    }
    if (!result.valid) {
      throw APIError.from('BAD_REQUEST', {
        code: PASSWORD_POLICY_ERROR_CODE,
        message: result.message,
      });
    }
  });
}
