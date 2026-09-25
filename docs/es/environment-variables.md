# Variables de entorno — EnVault Management

> 🇬🇧 English version: [../en/environment-variables.md](../en/environment-variables.md)

Ver los `.env.example` de cada app como fuente de verdad de qué variables existen. **Nunca commitear archivos `.env` con valores reales** — están en `.gitignore`.

---

## API (`apps/api/.env`)

Variables validadas por `src/config/env.validation.ts`. Las marcadas como **required** rompen el arranque si no están definidas.

```bash
# ── Database (required) ────────────────────────────────────────
DATABASE_URL=postgresql://envault_control:changeme@localhost:5432/envault_control

# ── Server ─────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173        # required en production

# ── Better Auth (required) ────────────────────────────────────
# Secret para firmar sesiones. Generar con:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
BETTER_AUTH_SECRET=<string-hex-de-64-chars>
BETTER_AUTH_URL=http://localhost:3000   # URL pública base de la API
BETTER_AUTH_ADMIN_EMAIL=admin@example.com
BETTER_AUTH_ADMIN_PASSWORD=<password-fuerte>

# ── Cifrado (required) ─────────────────────────────────────────
# Clave para cifrar passwords de conexiones en reposo (AES-256-GCM).
# Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<string-hex-de-64-chars>

# ── Cloudflare R2 (opcional en dev, required en producción) ────
R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<your-r2-access-key-id>
R2_SECRET_ACCESS_KEY=<your-r2-secret-access-key>
R2_BUCKET_NAME=envault-dumps
R2_PUBLIC_BASE_URL=

# ── Restore y Backup (opcional) ────────────────────────────────
# Timeout en milisegundos para restauraciones (default: 1800000 = 30 min).
RESTORE_TIMEOUT_MS=1800000
# Timeout en milisegundos para volcados/dumps (default: 1800000 = 30 min).
BACKUP_TIMEOUT_MS=1800000

# ── Redis y Colas BullMQ ───────────────────────────────────────
# En Docker Compose usar REDIS_HOST=redis. En Railway REDIS_URL se inyecta sola.
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
# REDIS_URL=redis://default:<password>@<host>:<port>
REDIS_TLS=false


# ── Seed script (vars individuales para dev local) ─────────────
# Nota: DB_NAME/DB_USER usan underscore porque PostgreSQL no acepta
# guiones en identifiers unquoted.
DB_HOST=localhost
DB_PORT=5432
DB_NAME=envault_control
DB_USER=envault_control
DB_PASSWORD=changeme
```

> En Docker Compose, `DATABASE_URL` usa el nombre del servicio como host (`db` en lugar de `localhost`).
>
> `CORS_ORIGIN` la sigue exigiendo la validación de env aunque las topologías same-origin de Docker Compose / Railway de más abajo hagan que el browser nunca llegue a la API cross-origin — ver la nota al lado, ahí abajo.

---

## Web (`apps/web/.env`)

```bash
# ── Vite build-time variables ──────────────────────────────────
# Se inyectan en el bundle estático en el momento del build.
# Nunca incluir secretos — son públicas en el cliente.

# Backend API URL (axios + SSE hook). Dejar vacía/sin setear para un
# deploy same-origin detrás del nginx del web (ver
# templates/default.conf.template, que usa la detección de resolver
# local que trae de fábrica nginx:alpine) — la SPA pasa a llamar a
# /api/* relativo.
VITE_API_URL=http://localhost:3000

# App base URL
VITE_APP_BASE_URL=http://localhost:5173
```

> Se pasan como `ARG` en el Dockerfile y se queman en el build estático — la SPA no las puede volver a leer en runtime.
>
> El contenedor web también lee `API_UPSTREAM` — a dónde su nginx proxea `/api/*` — pero es un valor de runtime, no uno de build-time de Vite, así que no es parte de `apps/web/.env`. Ver la sección de Docker Compose de abajo y, para Railway, `docs/es/deployment-railway.md`.

---

## Docker Compose (`.env` en la raíz)

Ambos compose (`docker-compose.yml` y `docker-compose.dev.yml`) leen el mismo `.env` raíz vía `env_file: .env`. Ya no existe `.env.local`: se consolidó.

Variables obligatorias para que `docker compose up` no aborte (fail-loud con `${VAR:?...}` en el compose):

```bash
# ── Database (obligatorias) ────────────────────────────────────
DB_NAME=envault_control
DB_USER=envault_control
DB_PASSWORD=  # ← REQUERIDA, sin default

# URL usada por la API para conectarse al servicio `db` interno
DATABASE_URL=postgresql://envault_control:CHANGE_ME@db:5432/envault_control

# ── Server ─────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
# La exige la validación de env, pero con el nginx del web adelante (ver
# docker-compose.yml) el browser sólo llega a la api same-origin — no
# tiene efecto sobre tráfico real, sólo conforma al chequeo.
CORS_ORIGIN=https://app.miempresa.com

# ── Better Auth (obligatorias) ─────────────────────────────────
BETTER_AUTH_SECRET=<string-hex-de-64-chars>
# Origen sin path. Better Auth agrega su propio basePath /api/auth — una
# URL que ya trae path (ej. ".../api") hace que se saltee ese append y
# rompe todas las rutas de auth en silencio.
BETTER_AUTH_URL=https://app.miempresa.com
BETTER_AUTH_ADMIN_EMAIL=admin@miempresa.com
BETTER_AUTH_ADMIN_PASSWORD=<password-fuerte>

# ── Cloudflare R2 (vacíos OK en development) ───────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=envault-dumps
R2_PUBLIC_BASE_URL=
```

Ver `.env.example` en la raíz para la plantilla completa con todas las claves y comentarios.
