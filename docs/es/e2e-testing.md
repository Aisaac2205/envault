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

Una ejecución correcta termina con `7 passed`.

> El primer `pnpm docker:e2e` construye las imágenes y tarda cerca de 3 minutos. Los arranques siguientes son mucho más rápidos.

---

## Qué cubre

| Tipo de prueba | Qué verifica | Carpeta | Estado |
|----------------|--------------|---------|--------|
| Smoke | Salud del stack (`/health`: API, base de datos y almacenamiento arriba), autenticación (`GET /connections` responde 401 sin sesión y 200 con sesión), página de login (se muestra el formulario, las rutas protegidas redirigen a ella, la sesión de admin guardada abre la app) | `e2e/tests/api`, `e2e/tests/ui` | Disponible |
| Suite de caja negra de la API | Autenticación, conexiones, validaciones, guard de roles, formato de errores | `e2e/tests/api` | Planificada |
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
├── support/               carga de .env.e2e, chequeo de que el stack esté listo, ruta de la sesión guardada
└── tests/
    ├── setup/             inicia sesión una vez y guarda la sesión del admin
    ├── api/               *.api.spec.ts  (HTTP, sin navegador)
    └── ui/                *.ui.spec.ts   (Chromium)
```

| Proyecto | Ejecuta | Notas |
|----------|---------|-------|
| `setup` | `tests/setup` | Espera al stack, inicia sesión como el admin sembrado y guarda la sesión en `e2e/.auth/admin.json`. Se ejecuta primero, de forma automática. |
| `api` | `tests/api` | Reutiliza la sesión guardada. |
| `ui-chromium` | `tests/ui` | Reutiliza la sesión guardada. |

Las specs reutilizan la sesión guardada en lugar de iniciar sesión: Better Auth permite solo 3 inicios de sesión cada 10 segundos por IP y ese límite no es configurable. **No agregues inicios de sesión a las specs.**

Salida generada (toda ignorada por git): `e2e/playwright-report/` (reporte HTML), `e2e/test-results/` (trazas y capturas de los fallos) y `e2e/.auth/` (la sesión guardada).

---

## Variantes de ejecución

Pasa los flags justo después de `pnpm test:e2e`, **sin** el separador `--` (con él, pnpm reenvía el `--` y Playwright ignora el filtro de proyecto).

```bash
pnpm test:e2e --project=api                    # solo las specs de la API
pnpm test:e2e --project=ui-chromium            # solo las specs del navegador
pnpm test:e2e tests/api/health.api.spec.ts     # un solo archivo
pnpm test:e2e -g "login"                       # tests cuyo título coincide
pnpm test:e2e --project=ui-chromium --headed   # ver el navegador
pnpm test:e2e --ui                             # modo UI de Playwright
pnpm test:e2e --project=ui-chromium --debug    # paso a paso con el Inspector
pnpm test:e2e:report                           # abrir el reporte HTML
```

El proyecto `setup` siempre se ejecuta primero, por lo que su test se cuenta en todas las ejecuciones. El reporte se sirve en `http://localhost:9323` (presiona `Ctrl+C` para detenerlo).

---

## Puntos de entrada

| Qué | Dónde | Notas |
|-----|-------|-------|
| Web + proxy de la API | `http://localhost:5173` | La API está bajo `/api`. |
| API (directa) | `http://localhost:3000` | Es el único lugar donde existe `/health`. |
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
| El inicio de sesión falla con HTTP 429 (`Too many requests`) | Más de 3 inicios de sesión en 10 segundos. Cada ejecución inicia sesión una vez, así que ocurre al lanzar ejecuciones seguidas. | Espera 10 segundos y vuelve a ejecutar. |
| El inicio de sesión falla con `INVALID_ORIGIN` | `E2E_BASE_URL` usa `127.0.0.1`. | Usa `localhost`. |
| El inicio de sesión falla con `INVALID_EMAIL_OR_PASSWORD`, o el stack arranca con valores inesperados | Una variable exportada en tu shell sobrescribe `.env.e2e` (tanto para Compose como para las pruebas). | Elimina la variable en ese shell (`unset`). |
| Necesitas empezar de cero | Los datos de una ejecución anterior siguen en los volúmenes. | `pnpm docker:e2e:down` borra los volúmenes; el siguiente `pnpm docker:e2e` arranca vacío. |
| Los restores fallan con `unrecognized configuration parameter "transaction_timeout"` | El PostgreSQL de origen es anterior a la versión 17 y el `pg_restore` de la imagen de la API es la versión 18. | Mantén `E2E_PG_IMAGE` en la versión 17 o superior (por defecto `postgres:18-alpine`). |
