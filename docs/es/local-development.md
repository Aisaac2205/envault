# Entorno Local — EnVault Management

> 🇬🇧 English version: [../en/local-development.md](../en/local-development.md)

Guía para levantar y desarrollar el proyecto localmente con Node.js o Docker.

Hay **dos archivos compose**:

| Archivo | Cuándo usarlo |
|---------|---------------|
| `docker-compose.yml` | Producción / validación del build final |
| `docker-compose.dev.yml` | Override para desarrollo (hot reload, puertos abiertos, perfil `test` opcional para DBs de testing) |

> ⚠️ **`docker-compose.dev.yml` NO se carga automáticamente** — el nombre `docker-compose.override.yml` (que Compose mergea sin pedirlo) se evita a propósito para que un `docker compose up` accidental en un servidor de prod no levante dev mode. Siempre pasar `-f docker-compose.yml -f docker-compose.dev.yml` o usar los scripts de `pnpm`.

---

## Opción A: Node.js (recomendado para desarrollo)

### Prerrequisitos

- Node.js >= 22
- pnpm >= 10 (`npm install -g pnpm`)
- Docker (solo para la DB)

### Pasos

**1. Instalar dependencias:**

```bash
pnpm install
```

**2. Configurar variables de entorno:**

```bash
cp .env.example .env
# Editar con los valores reales (Better Auth, R2, DB_PASSWORD)
```

> El `.env` raíz alimenta tanto al compose como a las apps cuando corren con `pnpm dev`. Ver [environment-variables.md](environment-variables.md) para la referencia completa.

**3. Levantar la DB:**

```bash
pnpm docker:db
```

**4. Iniciar desarrollo:**

```bash
pnpm dev
```

API en `http://localhost:3000` · Frontend en `http://localhost:5173`.

### Comandos útiles

```bash
# Solo API
pnpm --filter @vaultly-control/api dev

# Solo Web
pnpm --filter @vaultly-control/web dev

# Typecheck
pnpm typecheck

# Lint
pnpm lint

# Build para producción
pnpm build
```

### Depuración (debug)

```bash
# API con inspector de Node
NODE_OPTIONS="--inspect" pnpm --filter @vaultly-control/api dev
# Conectar debugger en puerto 9229
```

---

## Opción B: Docker (todo en contenedores)

### Prerrequisitos

- Docker + Docker Compose

### Desarrollo con hot reload

```bash
pnpm docker:dev
```

Equivale a:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

| Servicio | URL |
|----------|-----|
| Web | `http://localhost:5173` |
| API | `http://localhost:3000` |
| API (debug) | `localhost:9229` |
| DB | `localhost:5432` |

### Producción (sin hot reload)

```bash
pnpm docker:prod
```

Equivale a:

```bash
docker compose -f docker-compose.yml up --build
```

| Servicio | URL |
|----------|-----|
| Web | `http://localhost:5173` (puerto 80 del contenedor) |
| API | `http://localhost:3000` |
| DB | (no expuesto al host, solo red interna `db:5432`) |

### DBs de testing (PostgreSQL + MySQL)

Para probar el flow de `connections.test-raw` contra motores reales sin tocar bases productivas:

```bash
pnpm docker:dev:test       # api + web + db + db-test-pg + db-test-mysql
pnpm docker:db:test        # solo databases (api/web nativas)
```

Equivalen a:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile test up
```

El perfil `test` está definido en `docker-compose.dev.yml` y solo arranca cuando se pasa `--profile test` explícitamente.

### Comandos útiles

```bash
# Atajo común con flags propios
DC="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

# Logs
$DC logs -f api
$DC logs -f web

# Detener todo
$DC down

# Detener y borrar datos de DB (incluye db_test_pg_data y db_test_mysql_data)
$DC down -v

# Rebuild sin cache
$DC build --no-cache

# Estado
$DC ps
```

---

## Configuración de entorno (web)

El frontend usa un sistema de configuración en dos capas para soportar desarrollo local y despliegue GitOps sin `.env` en el repositorio:

### Resolución

```
1. window.APP_CONFIG  → runtime (Docker/GitOps: inyectado por entrypoint.sh)
2. import.meta.env    → build-time (desarrollo local con .env)
```

### Reglas

- **Nunca** leer `import.meta.env.VITE_*` directamente en el código. Siempre usar `APP_CONFIG` de `src/config.ts`.
- El archivo `.env` existe **solo localmente** (está en `.gitignore`) y nunca debe subirse al repositorio.
- En Docker, las variables llegan como variables de entorno del contenedor → `entrypoint.sh` las escribe en `/usr/share/nginx/html/config.js` → `index.html` carga ese script antes de la app.
- El build de Docker **nunca** tiene el archivo `.env` — no existe en CI/CD, staging ni producción.

### Variables requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `VITE_API_URL` | URL del backend | `http://localhost:3000` o `/api` |
| `VITE_APP_BASE_URL` | URL base de la app | `http://localhost:5173` |

### Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `src/config.ts` | Resolver central — lee `window.APP_CONFIG` primero, fallback a `import.meta.env` |
| `entrypoint.sh` | En Docker, escribe las vars del contenedor en `config.js` antes de arrancar nginx |
| `public/config.js` | Placeholder vacío para desarrollo local (evita 404) |
| `index.html` | Carga `<script src="/config.js">` antes del bundle |

---

## Infraestructura de testing

Para probar conexiones a diferentes motores de BD (perfil `test` de `docker-compose.dev.yml`):

| Engine | Host | Port | Database | User | Password |
|--------|------|------|----------|------|----------|
| PostgreSQL | localhost | 5434 | testdb | test_user | test_pass123 |
| MySQL | localhost | 3306 | testdb | test_user | test_pass123 |

Levantar:

```bash
pnpm docker:db:test
```

---

## Comparación

| | Node.js | Docker dev | Docker prod |
|---|---------|-----------|-------------|
| Hot reload | Sí | Sí | No |
| Setup | pnpm + Docker DB | Solo Docker | Solo Docker |
| Velocidad | Más rápido | Más lento (volúmenes) | Rápido |
| Aislamiento | Parcial | Total | Total |
| Debug | Fácil | Debugger en 9229 | Limitado |
| Config web | `.env` → `import.meta.env` | `.env` → `import.meta.env` | `.env` → `entrypoint.sh` → `config.js` |

**Recomendación:** usar Node.js para desarrollo diario, `pnpm docker:dev` para probar en contenedores, `pnpm docker:prod` para validar el build final.
