# Security Model

> 🇪🇸 Versión en español: [../es/security-model.md](../es/security-model.md)

This document captures the **security invariants** of the system. They are not suggestions — they are rules the code actively enforces. Breaking them requires code changes and will show up in review.

---

## 1. PROD invariants

### 1.1 PROD connections are immutable from the API

**Where:** `apps/api/src/modules/connections/connections.service.ts` (edit) and `apps/api/src/modules/connections/connection-deletion.service.ts` (delete)

```typescript
if (existing.environment === Environment.PROD) {
  throw new ForbiddenException(...);
}
```

| Operation | Rule |
|-----------|------|
| Edit a PROD connection (`PATCH`) | Always `403`, including moving `environment` away from `prod` |
| Reclassify a non-PROD connection as PROD | Always `403`: a PROD connection must be created as PROD |
| Delete a PROD connection (`DELETE`) | Admin only, with a step-up confirmation (below) |
| Delete a non-PROD connection | Admin only, no confirmation |

The reason: a PROD connection is the source of truth. Modifying it from the app opens the door for a user with API permissions to point the backup job at a rogue host and exfiltrate dumps, or to flip it to QA and restore over production.

**Step-up delete.** The `DELETE /connections/:id` body must carry the exact connection name (`confirmName`, compared as-is: case and spaces count) and the admin's current password (`password`). Better Auth's `verifyPassword` checks the password server-side against the session that sent the request, so a body cannot name another account. A missing field or a wrong name answers `403` without checking the password; a wrong password answers `403`. The web app asks for both in a confirmation dialog and shows no Edit action on PROD rows. Refused and accepted deletes are audited under `prod`, with the password redacted.

**Failed-attempt limit.** 5 wrong passwords per admin in 15 minutes answer `429` with `Retry-After`, without checking the password again. Correct passwords are not counted, and one admin's checks run one at a time, so parallel requests cannot run more than 5 checks. The counter lives in the API process memory: a restart resets it, and each API instance keeps its own (the supported deployment runs one replica).

**What a delete does.** It is a soft delete (`isActive = false`) of EnVault's own record: it removes the connection's metadata and access from the app and never connects to or changes the production database itself. Dumps already in R2 under the connection's slug stay in the bucket, but the app can no longer restore them: a restore looks up the dump's source by slug among active connections and refuses with `403`. A new connection never reuses the slug of a deleted one.

### 1.2 Backups can only originate from PROD

**Where:** `apps/api/src/modules/backup/backup.service.ts`

```typescript
if (connection.environment !== Environment.PROD) {
  throw new BadRequestException(...);
}
```

By design: this system exists to move data **from** PROD **into** testing environments. Backing up DEV/SQA makes no sense and is explicitly blocked.

### 1.3 Restores can never touch PROD

**Where:** `apps/api/src/modules/restore/restore.service.ts`

```typescript
if (targetEnvironment === Environment.PROD) {
  throw new ForbiddenException(...);
}
```

This is **the most critical rule**. Restoring over PROD would destroy live data.

> **Historical note:** A `NoProdRestoreGuard` used to exist at the controller level. It was removed because it inspected `body.targetEnvironment`, but the DTO has `targetConnectionId` (a UUID). The guard never found the field and always let requests through — fake protection. The real protection lives, and always lived, in the service, where the connection is resolved and its environment is read from DB. See `docs/scheduler-architecture.md` for the equivalent pattern.

---

## 2. Authentication

### Stack

- **Library**: Better Auth (email/password + admin plugin) — runs inside the NestJS API process. No external IdP.
- **Integration**: manual catch-all handler at `/api/auth/*` in `apps/api/src/auth/auth.controller.ts`
- **Session**: cookie-based (`httpOnly`), managed entirely by Better Auth via a pg adapter
- **Session validation**: `auth.api.getSession()` called per request by `BetterAuthGuard`. The session cookie cache is disabled (`session.cookieCache.enabled: false` in `auth.config.ts`), so every request checks the session against the database: a ban, a revoked session or a role change applies on the next request.
- **Database tables**: Better Auth manages its own schema (`user`, `session`, `account`, `verification`) via the pg adapter.
- **Frontend**: `better-auth/react` client with `useSession()` hook; cookies are sent automatically by the browser.
- **SSE**: cookies are sent natively by `EventSource` — no query-param token hack required.
- **Admin seed**: on first boot, a default admin user is created from `BETTER_AUTH_ADMIN_EMAIL` / `BETTER_AUTH_ADMIN_PASSWORD` env vars.

### Session data used by the API

| Field | Use |
|-------|-----|
| `session.user.id` | User ID, goes into `audit_logs.userId` and `backup_jobs.triggeredBy` |
| `session.user.name` | Human-readable identifier, used in logs |
| `session.user.email` | Used in `audit_logs.userEmail` |
| `session.user.role` | Looked up in the permission map (see [Authorization](#authorization-the-permission-map)) |

### Guard

`BetterAuthGuard` (in `apps/api/src/auth/auth.guard.ts`) and `PermissionsGuard` (see Authorization below) are registered **globally** (`APP_GUARD`, in that order, after the throttler). Every route needs a session and a feature that the permission map grants to the caller, unless it opts out, so a controller written without any decorator answers 401 without a session and 403 with one.

Conscious exceptions, all listed in `permission-coverage.spec.ts`: `@Public()` on `/health` (it is hit by the K8s probe) and on the Better Auth catch-all `/api/auth/*` (sign-in has to work without a session, and its admin routes check the session and role inside Better Auth), and `@AuthenticatedOnly()` on `GET /api/me/permissions`.

### Authorization: the permission map

Who may use what is decided in **one place**: `apps/api/src/common/authorization/permissions.ts`. Everything else is derived from it: the guard on each controller, the endpoint the web app reads, and through that endpoint the sidebar and the route guards. Before the map existed, the API (`@Roles('admin')` on every controller) and the web app (a hand-kept `adminOnly` list) each kept their own copy and drifted apart, so a regular user was offered screens whose every request answered 403 (defect D8).

```typescript
export const PERMISSIONS = {
  dashboard: ['admin'],
  dumps: ['admin'],
  restore: ['admin'],
  cronjobs: ['admin'],
  connections: ['admin'],
  cleanup: ['admin'],
  audit: ['admin'],
  users: ['admin'],
} as const satisfies Record<string, readonly Role[]>;
```

| Feature | Backs (API) | Web section |
|---------|-------------|-------------|
| `dashboard` | `/jobs`, `/jobs/analytics` | `/` |
| `dumps` | `/backups` | `/dumps` |
| `restore` | `/restores`, including its progress stream | `/restore` |
| `cronjobs` | `/cronjobs`, `/backups/settings` | `/cronjobs` |
| `connections` | `/connections` | `/connections` |
| `cleanup` | `/maintenance` | `/cleanup` |
| `audit` | `/audit` | `/audit`, `/audit/:id` |
| `users` | Better Auth admin plugin (`/api/auth/admin/*`) | `/users` |

How it works:

- **The server is authoritative.** The API checks the map on every request. The web app only uses it to decide what to show, which is a usability matter and never a security control (OWASP Authorization Cheat Sheet: enforce on the server, deny by default, least privilege).
- **Default-deny, at runtime.** The guards are global, so nothing is open by accident: a route that declares nothing, a feature that is not in the map, and a role that is not listed under a feature all end in 403 (401 without a session). The ways out are explicit: `@Public()` (no session needed), `@AuthenticatedOnly()` (a session, no feature) and, for everything else, `@RequirePermission('<feature>')`. A forgotten decorator closes the route instead of opening it.
- **Enforcement.** `BetterAuthGuard` and `PermissionsGuard` are registered globally (`common/authorization/global-guards.ts`, spread into `AppModule` after the throttler). Each controller only declares `@RequirePermission('<feature>')`. `BetterAuthGuard` answers 401 without a session; `PermissionsGuard` answers 403 when the map does not grant the feature to the caller's roles. A `@RequirePermission` on a single handler overrides the one on the class.
- **Several roles.** Better Auth stores a user's role as one comma-separated string (`"admin,user"`). The API splits it on commas, exactly as Better Auth does (no trimming: names are exact, case and spaces included, so `"user, admin"` does not grant `admin`), and grants a feature when any of the roles has it; `/me/permissions` returns the union.
- **Endpoint.** `GET /api/me/permissions` returns what the signed-in user may use, wrapped like every response: `{ "data": { "role": "admin", "features": ["dashboard", "dumps", ...] }, "timestamp": "..." }`. Any authenticated user may call it; without a session it answers 401.
- **Web.** The `usePermissions` hook (`apps/web/src/shared/hooks/usePermissions.ts`) loads that answer after the session. The sidebar offers the sections whose feature was granted, and `ProtectedRoute feature="..."` guards each route with the same answer. The app loader is shown while it loads, so a forbidden section never flashes. A user who is granted nothing lands on `/no-access` ("You don't have access to any section"), which keeps logging out reachable; a direct visit to a forbidden address redirects to the first section the user may open, or to that page. The answer is cached per user and per session, and dropped on sign-out. A 401 from the endpoint, even on a background refetch, ends the stale session and goes to the login screen (if the sign-out request itself fails, the login screen is told not to send the visitor straight back); any other failure, or being offline, shows a retry and log-out screen instead of a spinner. The web app compares no roles: a unit test fails if `adminOnly`, `requiredRole` or a `role === '...'` check comes back.
- **Drift tests.** `permission-coverage.spec.ts` (API) loads every controller in the source tree and fails when a route is neither public, session-only nor tied to a feature of the map, names a feature missing from it, or when a feature has no controller behind it. The public controllers (`HealthController`, `AuthController`) and the session-only one (`PermissionsController`) are an explicit list in that test, so opting a route out of the guards takes a reviewed change there. `default-deny.spec.ts` boots a small Nest app with the real global guards and proves that an undecorated controller answers 401 or 403. On the web, a route-table test checks that the sidebar and the routes agree for every section.
- **The `users` feature** has no Nest controller: its endpoints belong to the Better Auth admin plugin, which enforces its own `adminRoles` (default `['admin']`). The map entry only drives what the web app offers. A role that must manage users has to be added to both.

To add a feature: add its key to `PERMISSIONS`, put `@RequirePermission('<key>')` on its controller, and add the section (`shared/lib/sections.ts`) and the `ProtectedRoute` in the web app; the coverage test and the pinned feature list in `e2e/tests/api/authorization.api.spec.ts` fail until each side agrees.

To add a role (for example a read-only `viewer`): add it to `ROLES` and list it under the features it may use; the guard, the endpoint and the web app need no change, and the web app shows a role it has no translation for by its name. Because a feature grants a whole controller today, a read-only role also needs the endpoint-level split (reads and writes under different features, or a `@RequirePermission` per handler). That is a follow-up in the controllers, not in the guard. The `viewer` role does not exist yet.

---

## 3. Audit

### What gets audited?

Two independent sources write to the same append-only `audit_logs` table:

1. **Resource mutations** — any HTTP request with method `POST`, `PUT`, `PATCH` or `DELETE` that passes through the global `AuditInterceptor`. **Both successes and errors are audited** (`tap({ next, error })`). A failed attempt to delete PROD is also recorded.

2. **Authentication events** — sign-in, sign-out and password change, captured by a Better Auth `hooks.after` middleware (`src/auth/audit/`). The `AuditInterceptor` cannot see these: `auth.controller.ts` uses `@Res()` and discards the handler with `void`, so the Nest pipeline never observes the result.

The set of audited auth endpoints is an **allowlist** (`AUDITED_PATHS`), not a denylist. `hooks.after` fires on every auth endpoint including `/get-session`, which the SPA polls, so an unlisted path is never recorded and a new endpoint cannot silently flood the table.

The auth hook writes through the `pg` pool Better Auth already owns (`authPool`), because `auth.config.ts` is evaluated at import time, outside the Nest DI container. Every write is wrapped in `try/catch`: Better Auth re-throws anything that is not an `APIError` out of `runAfterHooks`, so an unhandled audit failure would replace the authentication response with a crash. **A missing audit row must never cost a user their sign-in.**

### Record structure

```typescript
{
  id: uuid,
  action: "DELETE /connections/abc-123" | "auth.sign-in.email",
  userId: "user-id" | "anonymous",
  username: "user@example.com" | "anonymous",
  resourceType: "ConnectionsController" | "Auth",
  resourceId: "abc-123" | "sign-in/email",
  metadata: { ...redacted body... },
  environment: "prod" | "dev" | "qa" | null,
  ipAddress: "203.0.113.7" | null,
  userAgent: string | null,
  outcome: "success" | "failure",
  severity: "low" | "medium" | "high" | "critical",
  createdAt: timestamp
}
```

`ipAddress`, `userAgent`, `outcome` and `severity` exist because the OWASP Logging Cheat Sheet requires source address, outcome and severity on every security event. The client address is read from `x-real-ip`, which nginx overwrites with a single validated value — the multi-hop `X-Forwarded-For` chain is spoofable and is never consulted.

`environment` is `null` for authentication events: the enum describes the environment of an audited ERP connection, and a sign-in belongs to none of them. Stamping one would poison the environment filter on the audit list.

### Known limitations

1. **`environment` defaults to `dev`** for resource mutations when the request includes neither an `environment` field in the body nor in params. This contaminates the dashboard with false DEVs. The column is now nullable (migration `1778716800019`), so the interceptor's `Environment.DEV` fallback can be dropped — that change is not made yet.

2. **Cronjobs are not audited in `audit_logs`.** They run in-process, not over HTTP, so the interceptor doesn't see them. Their traceability lives in `backup_jobs.triggeredBy = 'system-cronjob'`. If you need unified auditing, you must invoke the log manually from `CronjobsService.executeCronjob`.

3. **Logs are append-only at the DB level.** A row-level trigger (`audit_logs_immutable`) raises an exception on any `UPDATE` or `DELETE`, and a statement-level trigger (`audit_logs_no_truncate`) does the same for `TRUNCATE`, which never fires row-level triggers. The table owner can still disable or drop a trigger, so in production `audit_logs` should belong to a role that cannot log in, with the API's role granted only `SELECT` and `INSERT` on it. For cryptographic non-repudiation, records should additionally be signed or shipped to a WORM system.

---

## 4. Connection credentials

Passwords of registered DBs are **encrypted at rest** using AES-256-GCM in the `connections.password` column.

### How it works

- A TypeORM column transformer (`apps/api/src/common/utils/encryption.ts`) encrypts on write and decrypts on read using the `ENCRYPTION_KEY` environment variable.
- The stored value format is `iv:authTag:ciphertext` (all hex-encoded). Each write uses a random IV, so the same password produces a different ciphertext every time.
- The `@Exclude()` decorator from `class-transformer` ensures the decrypted password **never leaves the API** in HTTP responses.
- Repository list/detail queries use an explicit `select` that excludes the password column entirely. Only `findById` (used internally by backup/restore) returns it.
- Legacy plaintext values (from before encryption was added) are detected by the `decrypt` function (they lack the `iv:tag:ciphertext` format) and returned as-is, allowing a seamless migration.

### Requirements

- `ENCRYPTION_KEY` must be set as a 64-character hex string (256-bit key). Generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- If the key is lost, **all stored passwords become unrecoverable**. Back up the key securely.
- There is no automatic credential rotation yet.

---

## 5. CORS

```typescript
// apps/api/src/config/env.validation.ts
CORS_ORIGIN: Joi.string().required(),
```

If `CORS_ORIGIN` is not defined, **the app does not start**. No silent defaults or wildcards.
Set it to the exact frontend origin (e.g. `http://localhost:5173` or `https://app.example.com`).

---

## 6. Input validation

A single global `ValidationPipe`, registered once as `APP_PIPE` in `app.module.ts` and configured in `apps/api/src/common/pipes/validation-pipe.options.ts`:

```typescript
{
  whitelist: true,            // ignores props not declared in the DTO
  forbidNonWhitelisted: true, // rejects requests with extra props (400)
  transform: true,            // converts to the DTO class
  transformOptions: { enableImplicitConversion: true }, // coerces primitive types
}
```

Rejection applies to bodies and to query strings alike, so an undeclared query parameter is a 400 rather than a silently ignored filter.

Combined with `class-validator` on each DTO (`@IsString`, `@IsUUID`, `@IsEnum`, etc.). This covers **most** of the input-related OWASP Top 10. What it does NOT cover:

- **SQLi**: TypeORM with parameterized queries prevents it. The only raw SQL in the project is in `restore.service.ts` (`dryRun*`) and they are fixed queries without input interpolation.
- **SSRF on `host`/`port` of connections**: there is no validation against `localhost`/`169.254.169.254`/etc. If the system runs in cloud, consider a subnet allowlist.

---

## 7. Threat model summary

| Threat | Mitigation |
|--------|------------|
| User with a valid session deletes a PROD DB by mistake | Blocked: deleting a connection never touches the database it points to; it is a soft delete of EnVault's record, and for PROD it needs an admin's step-up confirmation (exact name + current password). Edits of a PROD connection and reclassification to PROD throw 403. See §1.1 |
| Stolen admin session used to delete a PROD connection | Mitigated: the delete needs the admin's current password, checked server-side; 5 wrong passwords per admin in 15 minutes answer 429 (in-process counter, reset on restart). See §1.1 |
| User maliciously restores an old dump on top of PROD | Blocked: `restore` throws 403 if target environment=PROD |
| Dump exfiltrated via R2 URL | Mitigated: private bucket, access via R2 credentials (not public) |
| Session cookie stolen via XSS | Mitigated: `httpOnly` flag prevents JavaScript access to the cookie; strict CORS in prod limits the origin |
| Control DB compromised → leak of PROD credentials | Mitigated: passwords encrypted with AES-256-GCM. Requires `ENCRYPTION_KEY` to decrypt. See §4 |
| Audit log tampered with by a DBA with access | Mitigated: append-only trigger prevents UPDATE/DELETE on `audit_logs`. See §3 |
| Cronjob points at attacker host | Mitigated: cronjob requires a `connectionId` that can only be created via `POST /connections` (audited) |
| Regular user reaches an admin feature because the API and the UI disagree | Mitigated: one permission map, enforced by the API with default-deny and read by the web app from `GET /api/me/permissions`; a coverage test fails when a controller escapes it. See §2 |
| Admin account compromised | Rotate `BETTER_AUTH_SECRET` to invalidate all sessions; reset admin password via Better Auth admin API |

Remaining unmitigated threats (SSRF on connection hosts, lack of credential rotation) are **conscious decisions** for the current scope of the system (internal tool, small team, private cloud).
