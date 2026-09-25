# Infraestructura — EnVault Management

> 🇬🇧 English version: [../en/infrastructure.md](../en/infrastructure.md)

Este documento cubre la infraestructura de **desarrollo local** (Docker Compose). Para el deploy de producción ver [deployment-railway.md](./deployment-railway.md).

## Docker

### Dockerfiles

Ambos Dockerfiles son multi-stage y viven junto a su app:

| Archivo | Stages |
|---------|--------|
| `apps/api/Dockerfile` | `build` (compilación TS) → `production` (Node mínimo) |
| `apps/web/Dockerfile` | `build` (Vite build) → `production` (nginx, puerto 80) |

### Docker Compose

| Archivo | Propósito |
|---------|-----------|
| `docker-compose.yml` | Producción: `api`, `web`, `db` con healthchecks, sin puertos expuestos para `db` |
| `docker-compose.dev.yml` | Override de desarrollo (hot reload, puertos abiertos, perfil `test` para DBs de testing) |

> **Better Auth** corre dentro del proceso de la API — no se necesita ningún servicio de auth externo. Configurar `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_ADMIN_EMAIL` y `BETTER_AUTH_ADMIN_PASSWORD` en `.env`.

> **`docker-compose.dev.yml` NO es auto-cargado** (renombrado desde `docker-compose.override.yml` para que `docker compose up` sin flags en un servidor de prod no arranque dev). Siempre pasar `-f` doble o usar scripts de `pnpm`.

### Levantar entorno de desarrollo local

```bash
# Solo la DB (si corrés API y Web con pnpm dev)
pnpm docker:db

# Stack completo en contenedores con hot reload
pnpm docker:dev
```

### Levantar infra de testing de conexiones

```bash
# Stack completo + DBs de testing (PostgreSQL :5434 + MySQL :3306)
pnpm docker:dev:test

# Solo databases (api/web nativas)
pnpm docker:db:test
```

Las DBs de testing están bajo `profiles: ["test"]` en `docker-compose.dev.yml` — solo arrancan con `--profile test`.

Credenciales de testing:

| Engine | Host | Port | Database | User | Password |
|--------|------|------|----------|------|----------|
| PostgreSQL | localhost | 5434 | testdb | test_user | test_pass123 |
| MySQL | localhost | 3306 | testdb | test_user | test_pass123 |
