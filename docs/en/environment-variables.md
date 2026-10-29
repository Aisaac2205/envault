# Environment Variables — EnVault Management

> 🇪🇸 Versión en español: [../es/environment-variables.md](../es/environment-variables.md)

The `.env.example` file inside each app is the source of truth for which variables exist. **Never commit `.env` files with real values** — they are in `.gitignore`.

---

## API (`apps/api/.env`)

Variables are validated by `src/config/env.validation.ts`. The ones marked as **required** break startup if undefined.

```bash
# ── Database (required) ────────────────────────────────────────
DATABASE_URL=postgresql://envault_control:changeme@localhost:5432/envault_control

# ── Server ─────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173        # required in production

# ── Better Auth (required) ────────────────────────────────────
# Secret for signing sessions. Generate with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
BETTER_AUTH_SECRET=<64-char-hex-string>
BETTER_AUTH_URL=http://localhost:3000   # public base URL of the API
BETTER_AUTH_ADMIN_EMAIL=admin@example.com
# Only used to create the first admin. 12 to 128 characters and the password
# policy: see the note below this block.
BETTER_AUTH_ADMIN_PASSWORD=<strong-password>

# ── Encryption (required) ──────────────────────────────────────
# Used to encrypt connection passwords at rest (AES-256-GCM).
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<64-char-hex-string>

# ── Cloudflare R2 (optional in dev, required in production) ────
R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<your-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<your-r2-secret-access-key>
R2_BUCKET_NAME=envault-dumps
R2_PUBLIC_BASE_URL=
# Optional endpoint override for S3-compatible stores such as MinIO. Leave it
# unset for Cloudflare R2. See the note below the block.
# R2_ENDPOINT=http://minio:9000

# ── Restore and Backup (optional) ──────────────────────────────
# Time limit in milliseconds for a whole restore, counted from when it starts
# running: the download from object storage and the pg_restore / mysql CLI
# together (default: 1800000 = 30 min). A restore that goes past it fails and
# the queue moves on. The final swap of a MySQL restore is never cut in half: it
# finishes or rolls back, and a swap that finishes late still counts as a
# completed restore.
RESTORE_TIMEOUT_MS=1800000
# Time in milliseconds a restore waits for a lock another session holds on the
# target's tables (default: 30000 = 30 s). PostgreSQL: a statement of pg_restore
# that has waited this long on a lock is cancelled, which rolls the restore back.
# MySQL: the final swap into the target applies it per step, in whole seconds. It
# applies per lock attempt, not to the whole restore, and while the restore waits
# the target application's own queries on those tables wait behind it. When it
# runs out the restore fails and the target is left unchanged.
RESTORE_LOCK_WAIT_TIMEOUT_MS=30000
# Timeout in milliseconds for database dump operations (default: 1800000 = 30 min).
BACKUP_TIMEOUT_MS=1800000
# Directory with one subdirectory per installed PostgreSQL client major
# (<root>/<major>/bin/pg_dump). Leave it unset in the API image: the default is
# /usr/lib/postgresql, where the image installs the clients 14 to 18.
# PG_CLIENT_BIN_ROOT=/usr/lib/postgresql

# ── Redis and BullMQ Queues ────────────────────────────────────
# In Docker Compose use REDIS_HOST=redis. In Railway REDIS_URL is auto-injected.
# REDIS_HOST is required in production unless REDIS_URL is set; it defaults to
# localhost elsewhere.
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
# REDIS_URL=redis://default:<password>@<host>:<port>
REDIS_TLS=false


# ── Seed script (individual vars for local dev) ────────────────
# Note: DB_NAME/DB_USER use underscore because PostgreSQL does
# not accept hyphens in unquoted identifiers.
DB_HOST=localhost
DB_PORT=5432
DB_NAME=envault_control
DB_USER=envault_control
DB_PASSWORD=changeme
```

> In Docker Compose, `DATABASE_URL` uses the service name as the host (`db` instead of `localhost`).
>
> `R2_ENDPOINT` (optional) points the backup storage at an S3-compatible server such as MinIO instead of Cloudflare R2. It must be an `http://` or `https://` URL. When it is set, the endpoint is no longer derived from `R2_ACCOUNT_ID` (which can then stay empty), requests use path-style addressing (`<endpoint>/<bucket>/<key>`), and the access key, secret key and bucket are still required. Presigned download URLs embed this endpoint, so it must be reachable by whoever follows them. Leave it unset (or blank) for Cloudflare R2: behavior is then unchanged.
>
> `REDIS_HOST` is required when `NODE_ENV=production` unless `REDIS_URL` is set; outside production it defaults to `localhost`. Without either, the API refuses to boot instead of silently connecting to `localhost`. Keep Redis on a private network (the Docker Compose network or Railway private networking); if it must cross a public network, use a `rediss://` `REDIS_URL` or `REDIS_TLS=true`.
>
> `CORS_ORIGIN` is still required by env validation even in the same-origin Docker Compose / Railway topologies below, where the browser never actually reaches the API cross-origin — see the note next to it there.
>
> `BETTER_AUTH_ADMIN_PASSWORD` is only used to create the first admin, and it must satisfy the [password policy](security-model.md#password-policy): 12 to 128 characters; not a common password or a pattern (`password1234`, `123456789012`, `qwertyuiop`); and not containing the part of `BETTER_AUTH_ADMIN_EMAIL` before the `@` or the name `Admin`, which the seeded account uses. If the password is refused, the API still boots, logs an error that names the unmet rule and creates no admin: set a stronger password and restart. While a user with `BETTER_AUTH_ADMIN_EMAIL` exists the variable is not read, so an existing admin is not re-validated and deployments that already have one are unaffected. The env validation (`env.validation.ts`) still only requires 8 characters; the policy is applied when the admin is created.

---

## Web (`apps/web/.env`)

```bash
# ── Vite build-time variables ──────────────────────────────────
# Baked into the static bundle at build time.
# Never include secrets — they are public in the client.

# Backend API URL (axios + SSE hook). Leave unset/empty for a same-origin
# deployment behind the web's nginx (see templates/default.conf.template,
# which uses nginx:alpine's own built-in local-resolver detection) — the
# SPA then calls a relative /api/*.
VITE_API_URL=http://localhost:3000

# App base URL
VITE_APP_BASE_URL=http://localhost:5173
```

> These are passed as `ARG` in the Dockerfile and burned into the static build — the SPA can't read them again at runtime.
>
> The published `ghcr.io/aisaac2205/envault-web` image is built with `VITE_API_URL` empty, so the SPA calls a relative `/api/*`. Its nginx CSP (`connect-src 'self'`) blocks any other origin, so a split-origin setup needs a custom build.
>
> The web container also reads `API_UPSTREAM` — where its nginx proxies `/api/*` to — but that's a runtime value, not a Vite build-time one, so it isn't part of `apps/web/.env`. See the Docker Compose section below and, for Railway, `docs/en/deployment-railway.md`.

---

## Docker Compose (`.env` at the root)

Both compose files (`docker-compose.yml` and `docker-compose.dev.yml`) read the same root `.env` via `env_file: .env`. There is no `.env.local` anymore: it was consolidated.

Mandatory variables for `docker compose up` not to abort (fail-loud with `${VAR:?...}` in the compose):

```bash
# ── Images (optional) ──────────────────────────────────────────
# Release of the published api and web images that docker-compose.yml runs.
# Defaults to latest; pin one so upgrades only happen when you change it.
ENVAULT_VERSION=1.57.0

# ── Database (mandatory) ───────────────────────────────────────
DB_NAME=envault_control
DB_USER=envault_control
DB_PASSWORD=  # ← REQUIRED, no default

# ── Redis (mandatory) ──────────────────────────────────────────
REDIS_HOST=redis  # the compose service; localhost does not reach it
REDIS_PASSWORD=  # ← REQUIRED, no default (Redis starts with --requirepass)

# URL used by the API to connect to the internal `db` service
DATABASE_URL=postgresql://envault_control:CHANGE_ME@db:5432/envault_control

# ── Server ─────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
# Required by env validation, but with the web's nginx in front (see
# docker-compose.yml) the browser only ever reaches the api same-origin —
# this has no effect on real traffic, it's just satisfying the check.
CORS_ORIGIN=https://app.mycompany.com

# ── Better Auth (mandatory) ────────────────────────────────────
BETTER_AUTH_SECRET=<64-char-hex-string>
# Bare origin, no path. Better Auth appends its own /api/auth basePath —
# a URL that already has a path (e.g. ".../api") makes it skip that
# append and silently breaks every auth route.
BETTER_AUTH_URL=https://app.mycompany.com
BETTER_AUTH_ADMIN_EMAIL=admin@mycompany.com
# 12 to 128 characters and the password policy (see the API section above).
BETTER_AUTH_ADMIN_PASSWORD=<strong-password>

# ── Cloudflare R2 (empty OK in development) ────────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=envault-dumps
R2_PUBLIC_BASE_URL=
# R2_ENDPOINT=http://minio:9000  # S3-compatible stores only; leave unset for Cloudflare R2
```

See the root `.env.example` for the full template with every key and comment.
