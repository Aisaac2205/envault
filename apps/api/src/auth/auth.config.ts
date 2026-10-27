import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { admin } from 'better-auth/plugins';
import { Pool } from 'pg';
import { createAuthAuditHook } from './audit/auth-audit-hook';
import { toJsonRecord } from './audit/to-json-record';

export const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// Better Auth already owns this pool for its own tables, so auditing through
// it adds no second route to the database and no second lifecycle to manage —
// AuthModule.onModuleDestroy already closes it. The Nest DI container is not
// available here: this module is evaluated at import time, before bootstrap.
const auditAuthEvent = createAuthAuditHook(async (sql, params) => {
  await authPool.query(sql, [...params]);
});

export const auth = betterAuth({
  database: authPool,
  baseURL: process.env.BETTER_AUTH_URL,
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : [],
  emailAndPassword: {
    enabled: true,
  },
  plugins: [admin()],
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      await auditAuthEvent({
        path: ctx.path,
        body: toJsonRecord(ctx.body),
        headers: ctx.headers,
        context: {
          returned: ctx.context.returned,
          newSession: ctx.context.newSession,
        },
      });
    }),
  },
  session: {
    // No cookie cache: every request checks the session against the database,
    // so a ban or a revoked session takes effect on the next request instead
    // of up to maxAge later (Better Auth documents this trade-off).
    cookieCache: {
      enabled: false,
    },
  },
  advanced: {
    // 'none' + partitioned only exists to support a browser that talks to
    // the api on a different origin than the web app. The supported
    // deployment path is the nginx reverse proxy (see
    // apps/web/templates/default.conf.template), which puts both behind
    // one origin — 'lax' is the correct, less CSRF-exposed default for
    // that, and localhost dev already qualifies too: SameSite compares
    // registrable domains, not ports, so localhost:5173 and
    // localhost:3000 count as the same site.
    defaultCookieAttributes: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
});

export type BetterAuthSession = typeof auth.$Infer.Session;
