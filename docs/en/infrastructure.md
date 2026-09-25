# Infrastructure — EnVault Management

> 🇪🇸 Versión en español: [../es/infrastructure.md](../es/infrastructure.md)

This document covers the **local development infrastructure** (Docker Compose). For production deploy see [deployment-railway.md](./deployment-railway.md).

## Docker

### Dockerfiles

Both Dockerfiles are multi-stage and live next to their app:

| File | Stages |
|------|--------|
| `apps/api/Dockerfile` | `build` (TS compilation) → `production` (minimal Node) |
| `apps/web/Dockerfile` | `build` (Vite build) → `production` (nginx, port 80) |

### Docker Compose

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production: `api`, `web`, `db` with healthchecks, no ports exposed for `db` |
| `docker-compose.dev.yml` | Development override (hot reload, open ports, `test` profile for testing DBs) |

> **Better Auth** runs inside the API process — no external auth service needed. Configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_ADMIN_EMAIL`, and `BETTER_AUTH_ADMIN_PASSWORD` in `.env`.

> **`docker-compose.dev.yml` is NOT auto-loaded** (renamed from `docker-compose.override.yml` so that `docker compose up` without flags on a prod server does not bring up dev). Always pass `-f` twice or use the `pnpm` scripts.

### Bring up local development

```bash
# DB only (when you run API and Web with pnpm dev)
pnpm docker:db

# Full stack in containers with hot reload
pnpm docker:dev
```

### Bring up connection testing infrastructure

```bash
# Full stack + testing DBs (PostgreSQL :5434 + MySQL :3306)
pnpm docker:dev:test

# DBs only (native api/web)
pnpm docker:db:test
```

The testing DBs are under `profiles: ["test"]` in `docker-compose.dev.yml` — they only start with `--profile test`.

Testing credentials:

| Engine | Host | Port | Database | User | Password |
|--------|------|------|----------|------|----------|
| PostgreSQL | localhost | 5434 | testdb | test_user | test_pass123 |
| MySQL | localhost | 3306 | testdb | test_user | test_pass123 |
