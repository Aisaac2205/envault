# Pruebas E2E — EnVault Management

> 🇬🇧 English version: [../en/e2e-testing.md](../en/e2e-testing.md)

Pruebas de extremo a extremo (E2E) que ejercitan EnVault desde afuera, como lo haría un usuario o un cliente de la API, contra un stack Docker similar al de producción. Usan [Playwright](https://playwright.dev) y viven en el paquete del workspace `e2e/` (`@vaultly-control/e2e`).

Es testing de **caja negra**: la suite solo habla HTTP y maneja un navegador real. Las pruebas unitarias de **caja blanca** siguen donde estaban, en Jest (`apps/api`) y Vitest (`apps/web`), y se ejecutan con `pnpm test`. `pnpm test` nunca recoge las specs E2E; estas tienen su propio comando, `pnpm test:e2e`.

---

## Camino rápido

Desde la raíz del repositorio:

| # | Comando | Qué hace |
|---|---------|----------|
| 1 | `cp .env.e2e.example .env.e2e` | Crea tu configuración local (ignorada por git). Una sola vez. |
| 2 | `pnpm install` | Instala el workspace, incluido Playwright. |
| 3 | `pnpm e2e:install` | Descarga el navegador Chromium que maneja Playwright. Una sola vez. |
| 4 | `pnpm docker:e2e` | Construye y levanta el stack de pruebas, y termina cuando está saludable. |
| 5 | `pnpm test:e2e` | Ejecuta la suite. |
| 6 | `pnpm docker:e2e:down` | Detiene el stack y borra sus datos. |

Una ejecución correcta termina con `148 passed` (el número crece a medida que se agregan suites). Las specs de defectos conocidos del producto están escritas para fallar y cuentan como pasadas; ver [Defectos conocidos](#defectos-conocidos).

> El primer `pnpm docker:e2e` construye las imágenes y tarda cerca de 3 minutos. Los arranques siguientes son mucho más rápidos.

---

## Qué cubre

| Tipo de prueba | Qué verifica | Carpeta | Estado |
|----------------|--------------|---------|--------|
| Smoke | Salud del stack (`/health`: API, base de datos y almacenamiento arriba), autenticación (`GET /connections` responde 401 sin sesión y 200 con sesión), página de login (se muestra el formulario, las rutas protegidas redirigen a ella, la sesión de admin guardada abre la app) | `e2e/tests/api`, `e2e/tests/ui` | Disponible |
| Suite de caja negra de la API | Inicio de sesión (contraseña incorrecta, correo desconocido, cookie de sesión alterada, guarda del límite de intentos); autorización (401 sin sesión, 403 para un usuario no admin, en cada endpoint de admin); conexiones (crear, leer, actualizar, eliminar, validaciones, la contraseña nunca se devuelve, `test-raw` contra PostgreSQL y MySQL, probar una conexión guardada); formato de errores (400, 401, 403, 404 y el cuerpo de éxito); forma de los endpoints de solo lectura de jobs, analítica, backups, restores y auditoría | `e2e/tests/api` | Disponible |
| Suite de caja negra de la UI | Flujos de login, conexiones y dashboard en el navegador | `e2e/tests/ui` | Planificada |
| Pipeline de backup / restore | Backup y restore funcionales de PostgreSQL y MySQL a través de la cola y el almacenamiento de objetos reales | Por definir | Planificada |
| Rendimiento | Duración, espera en cola y throughput de dumps y restores | Por definir | Planificada |

**No cubierto (por diseño):**

- Cobertura de caja blanca del código: eso lo hacen Jest y Vitest.
- Pruebas de carga o estrés con muchos usuarios concurrentes.
- Latencia de red hacia Cloudflare R2 real: el stack usa MinIO, un almacenamiento local compatible con S3, por lo que los tiempos excluyen ese salto.
- Integración con CI: por ahora la suite se ejecuta en la máquina del desarrollador.

Todo cambio que agregue o modifique una suite debe actualizar esta tabla.

---

## Defectos conocidos

La suite documenta los errores que encuentra en lugar de ocultarlos. Cada uno tiene una spec que verifica el comportamiento **correcto** y está marcada con `test.fail`: Playwright la ejecuta, espera que falle y la reporta como pasada. Cuando el producto se corrige, la spec empieza a pasar, Playwright reporta `Expected to fail, but passed` y hace fallar la ejecución; esa es la señal para borrar el `test.fail` y esta fila.

| Id | Dónde | Qué ocurre hoy | Spec |
|----|-------|----------------|------|
| D4 | `GET /api/health` | Responde 404. El dashboard llama a esta ruta, pero la API sirve el health fuera del prefijo `/api` (`/health`, solo en el puerto 3000). | `health.api.spec.ts` |
| D6 | `PATCH /api/connections/:id` | La respuesta contiene la contraseña descifrada. Crear, leer y listar sí la omiten. | `connections.api.spec.ts` |
| D7 | `GET /api/<recurso>/<id>` con un id que no es un UUID (connections, backups, restores, jobs, audit) | Responde 500 en lugar de un 4xx, porque el id llega a la base de datos sin validar. | `error-envelope.api.spec.ts` |

---

## Prerrequisitos

- Node.js >= 22 y pnpm >= 10
- Docker Desktop con Compose (verificado con Docker 29.8.2 y Compose v5.5.1)
- Estos puertos del host libres:

| Puerto | Lo usa |
|--------|--------|
| 5173 | Web y proxy de la API. **Es compartido con los compose de dev y prod: detén esos stacks primero** (ver [local-development.md](local-development.md)). |
| 3000 | API, publicada directamente |
| 5435 | PostgreSQL de origen |
| 3307 | MySQL de origen |
| 9000 / 9001 | MinIO (API S3 / consola) |

---

## Cómo está organizada la suite

```
e2e/
├── playwright.config.ts   proyectos: setup, api, ui-chromium
├── support/               carga de .env.e2e, chequeo de que el stack esté listo, ruta de la sesión guardada,
│                          fixtures (anónimo, usuario no admin, fábrica de conexiones), helpers del formato de respuesta
└── tests/
    ├── setup/             inicia sesión una vez y guarda la sesión del admin
    ├── api/               *.api.spec.ts  (HTTP, sin navegador)
    └── ui/                *.ui.spec.ts   (Chromium)
```

| Proyecto | Ejecuta | Notas |
|----------|---------|-------|
| `setup` | `tests/setup` | Espera al stack, inicia sesión como el admin sembrado y guarda la sesión en `e2e/.auth/admin.json`, salvo que la sesión guardada siga siendo válida. Se ejecuta primero, de forma automática. |
| `api` | `tests/api` | Reutiliza la sesión guardada. |
| `ui-chromium` | `tests/ui` | Reutiliza la sesión guardada. |

Archivos de specs de la API:

| Archivo | Cubre |
|---------|-------|
| `health.api.spec.ts` | Salud del stack; `/api/health` (defecto conocido) |
| `auth.api.spec.ts` | Smoke: `GET /connections` responde 401 sin sesión y 200 con sesión |
| `sign-in.api.spec.ts` | Contraseña incorrecta y correo desconocido, consulta de sesión, cookies alteradas, registro público cerrado, límite de inicios de sesión |
| `authorization.api.spec.ts` | 401 sin sesión y 403 para un usuario no admin, un test por endpoint de admin |
| `connections.api.spec.ts` | CRUD de conexiones, validaciones, sin contraseña en las respuestas, `test-raw`, probar una conexión guardada |
| `error-envelope.api.spec.ts` | El cuerpo de error para 400, 401, 403 y 404, el cuerpo de éxito, ids que no son UUID (defecto conocido) |
| `read-contracts.api.spec.ts` | Forma y conteos en cero de los endpoints de jobs, analítica, backups, restores y auditoría en un stack sin jobs |

### Iniciar sesión desde una spec

Better Auth permite solo 3 inicios de sesión cada 10 segundos por IP de cliente y ese límite no es configurable. Dos reglas mantienen la suite por debajo:

- `setup` es el único lugar que inicia sesión a través del proxy web. Lo hace como máximo una vez por ejecución, y ninguna mientras la sesión guardada siga siendo aceptada (consulta `GET /api/auth/get-session?disableCookieCache=true`, que verifica la base de datos en lugar de la cookie en caché), así que las ejecuciones seguidas nunca llegan al límite.
- Una spec que necesita su propio inicio de sesión (credenciales incorrectas, el usuario no admin, la guarda del límite) llama a `signInOnDirectApi` de `e2e/support/api.ts`. Hace el POST al puerto de la API (`:3000`) con un encabezado `X-Forwarded-For` único. Detrás del proxy todos los clientes comparten una dirección, porque nginx sobrescribe ese encabezado; el puerto de la API sí lo respeta, así que cada inicio de sesión tiene su propio contador y nunca toca el que usa `setup`.

Nunca cierres la sesión del admin compartido: todas las demás specs la usan. El usuario no admin se crea una vez por worker con el plugin de administración de Better Auth y se elimina cuando el worker termina.

Salida generada (toda ignorada por git): `e2e/playwright-report/` (reporte HTML), `e2e/test-results/` (trazas y capturas de los fallos) y `e2e/.auth/` (la sesión guardada).

---

## Variantes de ejecución

Pasa los flags justo después de `pnpm test:e2e`, **sin** el separador `--` (con él, pnpm reenvía el `--` y Playwright ignora el filtro de proyecto).

```bash
pnpm test:e2e --project=api                      # solo las specs de la API
pnpm test:e2e --project=ui-chromium              # solo las specs del navegador
pnpm test:e2e tests/api/connections.api.spec.ts  # un solo archivo
pnpm test:e2e -g "login"                         # tests cuyo título coincide
pnpm test:e2e --project=api -g "test-raw"        # tests de la API cuyo título coincide
pnpm test:e2e --project=api --repeat-each=3      # ejecuta cada test de la API 3 veces para detectar inestabilidad
pnpm test:e2e --project=ui-chromium --headed     # ver el navegador
pnpm test:e2e --ui                               # modo UI de Playwright
pnpm test:e2e --project=ui-chromium --debug      # paso a paso con el Inspector
pnpm test:e2e:report                             # abrir el reporte HTML
```

El proyecto `setup` siempre se ejecuta primero, por lo que su test se cuenta en todas las ejecuciones. El reporte se sirve en `http://localhost:9323` (presiona `Ctrl+C` para detenerlo).

---

## Puntos de entrada

| Qué | Dónde | Notas |
|-----|-------|-------|
| Web + proxy de la API | `http://localhost:5173` | La API está bajo `/api`. |
| API (directa) | `http://localhost:3000` | Es el único lugar donde existe `/health`. Las specs que inician sesión la usan (ver [Iniciar sesión desde una spec](#iniciar-sesión-desde-una-spec)). |
| MinIO (S3) | `http://localhost:9000` | Consola en `http://localhost:9001`. Ingresa con `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` de `.env.e2e`. |
| PostgreSQL de origen | `localhost:5435` | Base `testdb`, usuario `test_user`, contraseña `test_pass123`. |
| MySQL de origen | `localhost:3307` | Base `testdb`, usuario `test_user`, contraseña `test_pass123`. |

Usa siempre el nombre de host `localhost`, nunca `127.0.0.1`: la cookie de sesión es `Secure` y los navegadores y Playwright solo la envían por http plano a `localhost`.

---

## Variables de entorno que leen las pruebas

Las pruebas cargan el `.env.e2e` de la raíz del repositorio, el mismo archivo que configura el stack. Una variable ya exportada en tu shell tiene prioridad sobre el archivo.

| Variable | Valor por defecto | Para qué se usa |
|----------|-------------------|-----------------|
| `BETTER_AUTH_ADMIN_EMAIL` | de `.env.e2e` | Cuenta de admin que siembra el stack; las pruebas inician sesión con ella. |
| `BETTER_AUTH_ADMIN_PASSWORD` | de `.env.e2e` | Contraseña de ese admin. |
| `E2E_BASE_URL` | `http://localhost:5173` | Web y proxy de la API. |
| `E2E_DIRECT_API_URL` | `http://localhost:3000` | API directa. Cámbiala si sobrescribes `E2E_API_PORT`. |

---

## Solución de problemas

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `pnpm docker:e2e` falla con `Bind for 0.0.0.0:5173 failed: port is already allocated` | Otro stack (compose de dev o prod, u otra aplicación) tiene el puerto. | Detenlo y vuelve a ejecutar. |
| `The E2E stack is not ready: ... (last result: ECONNREFUSED)` | Las pruebas se ejecutaron con el stack apagado; reintentan durante 30 segundos antes de fallar. | Ejecuta `pnpm docker:e2e` y luego las pruebas de nuevo. |
| `couldn't find env file: ...\.env.e2e` o `E2E configuration is incomplete: ... .env.e2e does not exist` | Falta `.env.e2e`. | `cp .env.e2e.example .env.e2e` |
| El inicio de sesión falla con HTTP 429 (`Too many requests`) | Más de 3 inicios de sesión en 10 segundos a través del proxy. `setup` inicia sesión una vez como máximo, así que hacen falta varias ejecuciones lanzadas en pocos segundos sin una sesión guardada válida (tras `pnpm docker:e2e:down`, o con `e2e/.auth` borrado), o una spec que inicia sesión por el proxy. | Espera 10 segundos y vuelve a ejecutar. En una spec, usa `signInOnDirectApi`. |
| El inicio de sesión falla con `INVALID_ORIGIN` | `E2E_BASE_URL` usa `127.0.0.1`. | Usa `localhost`. |
| El inicio de sesión falla con `INVALID_EMAIL_OR_PASSWORD`, o el stack arranca con valores inesperados | Una variable exportada en tu shell sobrescribe `.env.e2e` (tanto para Compose como para las pruebas). | Elimina la variable en ese shell (`unset`). |
| `Expected to fail, but passed` en una spec marcada con `test.fail` | Se corrigió un defecto conocido. | Borra el `test.fail` y la fila en [Defectos conocidos](#defectos-conocidos). |
| Quedan cuentas `e2e-user-...@envault.local` tras una ejecución abortada | El usuario no admin de prueba se elimina cuando su worker termina; una ejecución cancelada se salta ese paso. | `pnpm docker:e2e:down` las borra junto con el resto de los datos. |
| Necesitas empezar de cero | Los datos de una ejecución anterior siguen en los volúmenes. | `pnpm docker:e2e:down` borra los volúmenes; el siguiente `pnpm docker:e2e` arranca vacío. |
| Los restores fallan con `unrecognized configuration parameter "transaction_timeout"` | El PostgreSQL de origen es anterior a la versión 17 y el `pg_restore` de la imagen de la API es la versión 18. | Mantén `E2E_PG_IMAGE` en la versión 17 o superior (por defecto `postgres:18-alpine`). |
