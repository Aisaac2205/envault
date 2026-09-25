# Local Environment — EnVault Management

> 🇪🇸 Versión en español: [../es/local-development.md](../es/local-development.md)

Guide to bringing the project up and developing it locally with Node.js or Docker.

There are **two compose files**:

| File | When to use it |
|------|----------------|
| `docker-compose.yml` | Production / validating the final build |
| `docker-compose.dev.yml` | Development override (hot reload, open ports, optional `test` profile for testing DBs) |

> ⚠️ **`docker-compose.dev.yml` is NOT auto-loaded** — the name `docker-compose.override.yml` (which Compose merges without asking) is avoided on purpose so that an accidental `docker compose up` on a prod server does not boot dev mode. Always pass `-f docker-compose.yml -f docker-compose.dev.yml` or use the `pnpm` scripts.

---

## Option A: Node.js (recommended for development)

### Prerequisites

- Node.js >= 22
- pnpm >= 10 (`npm install -g pnpm`)
- Docker (DB only)
- **PostgreSQL 16+** (provided by the `pnpm docker:db` script)

### Steps

**1. Install dependencies:**

```bash
pnpm install
```

**2. Configure environment variables:**

```bash
cp .env.example .env
# Edit with real values (Better Auth, R2, DB_PASSWORD)
```

> The root `.env` feeds both compose and the apps when running with `pnpm dev`. See [environment-variables.md](environment-variables.md) for the full reference.

**3. Bring up the DB:**

```bash
pnpm docker:db
```

**4. Start development:**

```bash
pnpm dev
```

API on `http://localhost:3000` · Frontend on `http://localhost:5173`.

### Useful commands

```bash
# API only
pnpm --filter @vaultly-control/api dev

# Web only
pnpm --filter @vaultly-control/web dev

# Typecheck
pnpm typecheck

# Lint
pnpm lint

# Production build
pnpm build
```

### Debugging

```bash
# API with the Node inspector
NODE_OPTIONS="--inspect" pnpm --filter @vaultly-control/api dev
# Attach the debugger on port 9229
```

---

## Option B: Docker (everything in containers)

### Prerequisites

- Docker + Docker Compose

### Development with hot reload

```bash
pnpm docker:dev
```

Equivalent to:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

| Service | URL |
|---------|-----|
| Web | `http://localhost:5173` |
| API | `http://localhost:3000` |
| API (debug) | `localhost:9229` |
| DB | `localhost:5432` |

### Production (no hot reload)

```bash
pnpm docker:prod
```

Equivalent to:

```bash
docker compose -f docker-compose.yml up --build
```

| Service | URL |
|---------|-----|
| Web | `http://localhost:5173` (container port 80) |
| API | `http://localhost:3000` |
| DB | (not exposed to the host, internal network only `db:5432`) |

### Testing DBs (PostgreSQL + MySQL)

To exercise the `connections.test-raw` flow against real engines without touching production databases:

```bash
pnpm docker:dev:test       # api + web + db + db-test-pg + db-test-mysql
pnpm docker:db:test        # DBs only (native api/web)
```

Equivalent to:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile test up
```

The `test` profile is defined in `docker-compose.dev.yml` and only starts when `--profile test` is passed explicitly.

### Useful commands

```bash
# Common alias with the dev flags
DC="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

# Logs
$DC logs -f api
$DC logs -f web

# Stop everything
$DC down

# Stop and wipe DB data (includes db_test_pg_data and db_test_mysql_data)
$DC down -v

# Rebuild without cache
$DC build --no-cache

# Status
$DC ps
```

---

## Web environment configuration

The frontend uses a two-layer configuration system to support local development and GitOps deployments without `.env` files in the repo:

### Resolution

```
1. window.APP_CONFIG  → runtime (Docker/GitOps: injected by entrypoint.sh)
2. import.meta.env    → build-time (local development with .env)
```

### Rules

- **Never** read `import.meta.env.VITE_*` directly in code. Always use `APP_CONFIG` from `src/config.ts`.
- The `.env` file exists **locally only** (it's in `.gitignore`) and must never be pushed to the repo.
- In Docker, variables arrive as container env vars → `entrypoint.sh` writes them into `/usr/share/nginx/html/config.js` → `index.html` loads that script before the app.
- The Docker build **never** has the `.env` file — it does not exist in CI/CD, staging or production.

### Required variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Backend URL | `http://localhost:3000` or `/api` |
| `VITE_APP_BASE_URL` | App base URL | `http://localhost:5173` |

### Key files

| File | Purpose |
|------|---------|
| `src/config.ts` | Central resolver — reads `window.APP_CONFIG` first, falls back to `import.meta.env` |
| `entrypoint.sh` | In Docker, writes container vars into `config.js` before nginx starts |
| `public/config.js` | Empty placeholder for local dev (avoids 404) |
| `index.html` | Loads `<script src="/config.js">` before the bundle |

---

## Testing infrastructure

To test connections against different DB engines (`test` profile in `docker-compose.dev.yml`):

| Engine | Host | Port | Database | User | Password |
|--------|------|------|----------|------|----------|
| PostgreSQL | localhost | 5434 | testdb | test_user | test_pass123 |
| MySQL | localhost | 3306 | testdb | test_user | test_pass123 |

Bring up:

```bash
pnpm docker:db:test
```

---

## Comparison

| | Node.js | Docker dev | Docker prod |
|---|---------|-----------|-------------|
| Hot reload | Yes | Yes | No |
| Setup | pnpm + Docker DB | Docker only | Docker only |
| Speed | Faster | Slower (volumes) | Fast |
| Isolation | Partial | Full | Full |
| Debug | Easy | Debugger on 9229 | Limited |
| Web config | `.env` → `import.meta.env` | `.env` → `import.meta.env` | `.env` → `entrypoint.sh` → `config.js` |

**Recommendation:** use Node.js for daily development, `pnpm docker:dev` to test in containers, `pnpm docker:prod` to validate the final build.
