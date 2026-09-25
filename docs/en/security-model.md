# Security Model

> 🇪🇸 Versión en español: [../es/security-model.md](../es/security-model.md)

This document captures the **security invariants** of the system. They are not suggestions — they are rules the code actively enforces. Breaking them requires code changes and will show up in review.

---

## 1. PROD invariants

### 1.1 PROD connections are immutable from the API

**Where:** `apps/api/src/modules/connections/connections.service.ts`

```typescript
if (existing.environment === Environment.PROD) {
  throw new ForbiddenException(...);
}
```

Applies to `update()` and `delete()`. The reason: a PROD connection is the source of truth. Modifying it from the app opens the door for a user with API permissions to point the backup job at a rogue host and exfiltrate dumps.

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
- **Session validation**: `auth.api.getSession()` called per request by `BetterAuthGuard`. Sessions are cached with a 5-minute TTL to reduce DB round-trips.
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
| `session.user.role` | Role check (`admin` vs regular user) |

### Guard

`BetterAuthGuard` (in `apps/api/src/auth/auth.guard.ts`) is applied **explicitly** on every controller. There is no global guard. If you add a new controller, **remember to protect its endpoints**.

Conscious exception: `/health` does not require auth (it is hit by the K8s probe).

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

3. **Logs are append-only at the DB level.** A trigger (`audit_logs_immutable`) raises an exception on any `UPDATE` or `DELETE` attempt on the `audit_logs` table. This prevents tampering even by users with direct DB access. For cryptographic non-repudiation, records should additionally be signed or shipped to a WORM system.

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
| User with a valid session deletes a PROD DB by mistake | Blocked: `update`/`delete` throw 403 if environment=PROD |
| User maliciously restores an old dump on top of PROD | Blocked: `restore` throws 403 if target environment=PROD |
| Dump exfiltrated via R2 URL | Mitigated: private bucket, access via R2 credentials (not public) |
| Session cookie stolen via XSS | Mitigated: `httpOnly` flag prevents JavaScript access to the cookie; strict CORS in prod limits the origin |
| Control DB compromised → leak of PROD credentials | Mitigated: passwords encrypted with AES-256-GCM. Requires `ENCRYPTION_KEY` to decrypt. See §4 |
| Audit log tampered with by a DBA with access | Mitigated: append-only trigger prevents UPDATE/DELETE on `audit_logs`. See §3 |
| Cronjob points at attacker host | Mitigated: cronjob requires a `connectionId` that can only be created via `POST /connections` (audited) |
| Admin account compromised | Rotate `BETTER_AUTH_SECRET` to invalidate all sessions; reset admin password via Better Auth admin API |

Remaining unmitigated threats (SSRF on connection hosts, lack of credential rotation) are **conscious decisions** for the current scope of the system (internal tool, small team, private cloud).
