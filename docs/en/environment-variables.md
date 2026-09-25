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

# ── Restore and Backup (optional) ──────────────────────────────
# Timeout in milliseconds for database restore operations (default: 1800000 = 30 min).
RESTORE_TIMEOUT_MS=1800000
# Timeout in milliseconds for database dump operations (default: 1800000 = 30 min).
BACKUP_TIMEOUT_MS=1800000

# ── Redis and BullMQ Queues ────────────────────────────────────
# In Docker Compose use REDIS_HOST=redis. In Railway REDIS_URL is auto-injected.
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
> `CORS_ORIGIN` is still required by env validation even in the same-origin Docker Compose / Railway topologies below, where the browser never actually reaches the API cross-origin — see the note next to it there.

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
> The web container also reads `API_UPSTREAM` — where its nginx proxies `/api/*` to — but that's a runtime value, not a Vite build-time one, so it isn't part of `apps/web/.env`. See the Docker Compose section below and, for Railway, `docs/en/deployment-railway.md`.

---

## Docker Compose (`.env` at the root)

Both compose files (`docker-compose.yml` and `docker-compose.dev.yml`) read the same root `.env` via `env_file: .env`. There is no `.env.local` anymore: it was consolidated.

Mandatory variables for `docker compose up` not to abort (fail-loud with `${VAR:?...}` in the compose):

```bash
# ── Database (mandatory) ───────────────────────────────────────
DB_NAME=envault_control
DB_USER=envault_control
DB_PASSWORD=  # ← REQUIRED, no default

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
BETTER_AUTH_ADMIN_PASSWORD=<strong-password>

# ── Cloudflare R2 (empty OK in development) ────────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=envault-dumps
R2_PUBLIC_BASE_URL=
```

See the root `.env.example` for the full template with every key and comment.
