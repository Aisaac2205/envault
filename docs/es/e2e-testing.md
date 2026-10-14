# Pruebas E2E — EnVault Management

> 🇬🇧 English version: [../en/e2e-testing.md](../en/e2e-testing.md)

Pruebas de extremo a extremo (E2E) que ejercitan EnVault desde afuera, como lo haría un usuario o un cliente de la API, contra un stack Docker similar al de producción. Usan [Playwright](https://playwright.dev) y viven en el paquete del workspace `e2e/` (`@vaultly-control/e2e`).

Es testing de **caja negra**: la suite solo habla HTTP y maneja un navegador real. Las pruebas unitarias de **caja blanca** siguen donde estaban, en Jest (`apps/api`) y Vitest (`apps/web`), y se ejecutan con `pnpm test`. `pnpm test` nunca recoge las specs E2E; estas tienen su propio comando, `pnpm test:e2e`. La suite de rendimiento es un benchmark aparte, con su propio comando, `pnpm test:e2e:perf`, y tampoco forma parte de `pnpm test:e2e`.

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

Una ejecución correcta termina con `250 passed` y `1 skipped` (los números crecen a medida que se agregan suites). Las specs de defectos conocidos del producto están escritas para fallar y cuentan como pasadas, y el único test omitido solo se ejecuta contra un PostgreSQL antiguo; ver [Defectos conocidos](#defectos-conocidos) y [Tests de backup y restore](#tests-de-backup-y-restore).

> El primer `pnpm docker:e2e` construye las imágenes y tarda cerca de 3 minutos. Los arranques siguientes son mucho más rápidos.

---

## Qué cubre

| Tipo de prueba | Qué verifica | Carpeta | Estado |
|----------------|--------------|---------|--------|
| Smoke | Salud del stack (`/health`: API, base de datos y almacenamiento arriba), autenticación (`GET /connections` responde 401 sin sesión y 200 con sesión), página de login (se muestra el formulario, las rutas protegidas redirigen a ella, la sesión de admin guardada abre la app) | `e2e/tests/api`, `e2e/tests/ui` | Disponible |
| Suite de caja negra de la API | Inicio de sesión (contraseña incorrecta, correo desconocido, cookie de sesión alterada, guarda del límite de intentos); autorización (401 sin sesión, 403 para un usuario no admin, en cada endpoint de admin); conexiones (crear, leer, actualizar, eliminar, validaciones, la contraseña nunca se devuelve, `test-raw` contra PostgreSQL y MySQL, probar una conexión guardada); formato de errores (400, 401, 403, 404 y el cuerpo de éxito); forma de los endpoints de solo lectura de jobs, analítica, backups, restores y auditoría | `e2e/tests/api` | Disponible |
| Suite de caja negra de la UI | Login (formulario, validación del navegador, contraseña incorrecta, inicio de sesión correcto que sobrevive a una recarga, mostrar u ocultar la contraseña, cierre de sesión de su propia sesión); navegación y roles (cada sección de la barra lateral abre su página, un usuario normal solo ve y alcanza lo que no es exclusivo de admin); conexiones (estado vacío, crear PostgreSQL y MySQL con el formulario, validación del formulario, probar la conexión desde el formulario y desde una fila, filtrar, editar, eliminar con confirmación, la contraseña nunca se muestra); dashboard (título, tarjetas de KPI, paneles, solo peticiones exitosas, un sistema vacío); direcciones desconocidas | `e2e/tests/ui` | Disponible |
| Pipeline de backup / restore | Backups y restores reales de PostgreSQL y MySQL a través de la API, la cola, `pg_dump` / `mysqldump`, el almacenamiento de objetos y `pg_restore` / `mysql`, sobre bases de datos que las propias pruebas siembran: campos del job, el dump descargado con su URL firmada (tamaño y SHA-256), el manifiesto, restore a destinos `dev` y `qa` con conteos de filas y checksum de datos iguales a los del origen, un dry run que no cambia nada, restore a `prod` rechazado, peticiones mal formadas y desconocidas, un backup pendiente devuelto a peticiones repetidas, backups fallidos (mensaje de error, ningún objeto), listas de jobs, historial y analítica; un recorrido de UI que inicia un backup desde la página Dumps | `e2e/tests/pipeline`, `e2e/tests/ui` | Disponible |
| Rendimiento | Throughput de backup y restore por motor y tamaño de conjunto de datos (de unos 10 MiB a 1 GiB), concurrencia de BullMQ (K backups simultáneos, uno contra dos restores), tiempos de carga en frío de las pantallas en Chromium, latencia de la API; resultados en JSON, CSV y Markdown | `e2e/tests/perf` | Disponible (opcional, ver [Suite de rendimiento](#suite-de-rendimiento)) |

**No cubierto (por diseño):**

- Cobertura de caja blanca del código: eso lo hacen Jest y Vitest.
- Pruebas de carga o estrés con muchos usuarios concurrentes.
- Latencia de red hacia Cloudflare R2 real: el stack usa MinIO, un almacenamiento local compatible con S3, por lo que los tiempos excluyen ese salto.
- Capturas visuales, auditorías de accesibilidad y navegadores distintos de Chromium.
- Integración con CI: por ahora la suite se ejecuta en la máquina del desarrollador.

Todo cambio que agregue o modifique una suite debe actualizar esta tabla.

---

## Defectos conocidos

La suite documenta los errores que encuentra en lugar de ocultarlos. Cada uno tiene una spec que verifica el comportamiento **correcto** y está marcada con `test.fail`: Playwright la ejecuta, espera que falle y la reporta como pasada. Cuando el producto se corrige, la spec empieza a pasar, Playwright reporta `Expected to fail, but passed` y hace fallar la ejecución; esa es la señal para borrar el `test.fail` y esta fila. D1 es la excepción: su spec describe el fallo en sí y solo se ejecuta contra un PostgreSQL antiguo, así que pasa hoy y empieza a fallar cuando el defecto se corrige; bórrala entonces.

| Id | Dónde | Qué ocurre hoy | Spec |
|----|-------|----------------|------|
| D1 | Restore a un PostgreSQL anterior a la versión 17 | El `pg_restore` de la imagen de la API es la versión 18 y se aborta en `SET transaction_timeout`, así que todo restore falla. Ver [PostgreSQL anterior a la versión 17 (D1)](#postgresql-anterior-a-la-versión-17-d1). | `restore.pipeline.spec.ts` |
| D4 | `GET /api/health` | Responde 404: la API sirve el health fuera del prefijo `/api` (`/health`, solo en el puerto 3000). El cliente de API del dashboard declara una llamada a esta ruta, pero ninguna pantalla la hace, así que hoy la UI no muestra el problema (`dashboard.ui.spec.ts` falla si una pantalla empieza a llamarla). | `health.api.spec.ts` |
| D6 | `PATCH /api/connections/:id` | La respuesta contiene la contraseña descifrada. Crear, leer y listar sí la omiten. | `connections.api.spec.ts` |
| D7 | `GET /api/<recurso>/<id>` con un id que no es un UUID (connections, backups, restores, jobs, audit) | Responde 500 en lugar de un 4xx, porque el id llega a la base de datos sin validar. | `error-envelope.api.spec.ts` |
| D8 | `/`, `/restore`, `/cronjobs` y `/audit` como usuario normal (rol `user`) | La barra lateral ofrece estas pantallas, pero todos los endpoints de la API que las alimentan son exclusivos de admin y responden 403, así que el usuario ve ceros, tablas vacías o una carga que nunca termina, sin ningún mensaje. | `navigation.ui.spec.ts` |
| D9 | Cualquier dirección que el router no conoce | Muestra la pantalla de error para desarrolladores de React Router (`Unexpected Application Error! 404 Not Found`) en lugar de una página del producto. | `navigation.ui.spec.ts` |
| D10 | Página de conexiones, toast de éxito de **Test connection** en una conexión guardada | La descripción dice `Latencia: 5ms` en español dentro de la interfaz en inglés; el texto traducido existe pero no se usa. | `connections.ui.spec.ts` |
| D11 | Formulario de login cuando la API no es alcanzable | La petición falla a nivel de red, el botón se queda en `Signing in...` y no aparece ningún mensaje, así que el formulario no se puede volver a usar sin recargar. | `login.ui.spec.ts` |
| D12 | `POST /api/restores` sin `sourceBackupId` ni `r2Key` | La validación lo acepta y la búsqueda de un id de backup indefinido devuelve una fila cualquiera de la tabla, así que la respuesta es un 403 o un 202 para un backup que nadie nombró, en lugar de un 400. | `rules.pipeline.spec.ts` |
| D13 | Manifiesto de un backup de PostgreSQL | `source.serverVersion` siempre es `unknown`: la captura lee la columna equivocada de `SHOW server_version`. Los manifiestos de MySQL sí traen la versión real. | `backup.pipeline.spec.ts` |

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
├── playwright.config.ts   proyectos: setup, api, pipeline, ui-chromium
├── playwright.perf.config.ts   proyectos: perf-unit, setup, perf (el benchmark; nunca forma parte de pnpm test:e2e)
├── support/               carga de .env.e2e, chequeo de que el stack esté listo, ruta de la sesión guardada,
│                          fixtures (anónimo, cliente de API admin, usuario no admin, fábrica y limpieza
│                          de conexiones), helpers del formato de respuesta, respuestas de API simuladas (mock-api.ts),
│                          enrutado del límite de intentos para el navegador (browser.ts), page objects (pages/),
│                          pipeline: bases de datos de origen y datos de siembra (databases.ts, seed-data.ts),
│                          seguimiento de jobs (jobs.ts), almacenamiento de objetos (storage.ts), fixtures (pipeline-fixtures.ts),
│                          rendimiento: ajustes, conjuntos de datos, tiempos, estadística, reporte y reporter (perf/)
└── tests/
    ├── setup/             inicia sesión una vez y guarda la sesión del admin
    ├── api/               *.api.spec.ts       (HTTP, sin navegador)
    ├── pipeline/          *.pipeline.spec.ts  (HTTP, jobs reales de backup y restore)
    ├── perf/              *.perf.spec.ts (el benchmark), *.unit.spec.ts (sus helpers, sin stack)
    └── ui/                *.ui.spec.ts        (Chromium)
```

| Proyecto | Ejecuta | Notas |
|----------|---------|-------|
| `setup` | `tests/setup` | Espera al stack, inicia sesión como el admin sembrado y guarda la sesión en `e2e/.auth/admin.json`, salvo que la sesión guardada siga siendo válida. Se ejecuta primero, de forma automática. |
| `api` | `tests/api` | Reutiliza la sesión guardada. |
| `pipeline` | `tests/pipeline` | Reutiliza la sesión guardada. Da 120 s a cada test porque los jobs son asíncronos. Siembra bases de datos de origen desde el host (ver [Tests de backup y restore](#tests-de-backup-y-restore)). Forma parte de la ejecución por defecto. |
| `ui-chromium` | `tests/ui` | Reutiliza la sesión guardada. Sus llamadas de autenticación usan un contador de límite propio (ver [Specs del navegador y el límite de intentos](#specs-del-navegador-y-el-límite-de-intentos)). |
| `perf-unit` | `tests/perf` (`*.unit.spec.ts`) | Solo en `playwright.perf.config.ts`. Pruebas unitarias de los helpers de estadística; no necesitan el stack. `setup` depende de él ahí, así que un helper roto detiene una ejecución del benchmark antes de que empiece. |
| `perf` | `tests/perf` (`*.perf.spec.ts`) | Solo en `playwright.perf.config.ts`. El benchmark, un worker y un test a la vez. Ver [Suite de rendimiento](#suite-de-rendimiento). |

Salida generada (toda ignorada por git): `e2e/playwright-report/` (reporte HTML), `e2e/test-results/` (trazas y capturas de los fallos) y `e2e/.auth/` (la sesión guardada); la suite de rendimiento agrega `e2e/perf-results/` (una carpeta por ejecución) y `e2e/test-results-perf/`.

Archivos de specs de la API:

| Archivo | Cubre |
|---------|-------|
| `health.api.spec.ts` | Salud del stack; `/api/health` (defecto conocido) |
| `auth.api.spec.ts` | Smoke: `GET /connections` responde 401 sin sesión y 200 con sesión |
| `sign-in.api.spec.ts` | Contraseña incorrecta y correo desconocido, consulta de sesión, cookies alteradas, registro público cerrado, límite de inicios de sesión |
| `authorization.api.spec.ts` | 401 sin sesión y 403 para un usuario no admin, un test por endpoint de admin |
| `connections.api.spec.ts` | CRUD de conexiones, validaciones, sin contraseña en las respuestas, `test-raw`, probar una conexión guardada |
| `error-envelope.api.spec.ts` | El cuerpo de error para 400, 401, 403 y 404, el cuerpo de éxito, ids que no son UUID (defecto conocido) |
| `read-contracts.api.spec.ts` | Forma e invariantes de los conteos (los totales suman, los conteos son enteros no negativos, las listas son arreglos) de los endpoints de jobs, analítica, backups, restores y auditoría; las tablas de jobs casi nunca están vacías porque el proyecto `pipeline` las llena |

Archivos de specs de la UI (los page objects están en `e2e/support/pages/`; los locators usan los textos en inglés de la aplicación web, que es lo que muestra cuando el navegador no tiene un idioma guardado):

| Archivo | Cubre |
|---------|-------|
| `login.ui.spec.ts` | Formulario, validación del navegador con datos vacíos o mal formados, contraseña incorrecta, mensaje del límite de intentos, inicio de sesión correcto que sobrevive a una recarga, mostrar u ocultar la contraseña, cierre de su propia sesión, visitantes con sesión que salen de `/login`, API no alcanzable (defecto conocido) |
| `navigation.ui.spec.ts` | Secciones y enlaces de la barra lateral, abrir cada sección como admin, qué ve un usuario normal, de dónde se le redirige y qué puede abrir, los datos detrás de las pantallas que un usuario normal abre (defecto conocido), direcciones desconocidas (defecto conocido) |
| `connections.ui.spec.ts` | Estado vacío, formulario de creación y su validación, crear conexiones PostgreSQL y MySQL, probar desde el formulario y desde una fila, filtrar, editar, eliminar y cancelar la confirmación, redacción del toast de éxito (defecto conocido) |
| `dashboard.ui.spec.ts` | Título y tarjetas de KPI, paneles, solo peticiones exitosas, un sistema vacío |
| `dumps.ui.spec.ts` | Inicia un backup desde la página Dumps y lo ve completado en el historial (detrás de la pantalla corre el pipeline real) |

Las specs de login se ejecutan en una ventana de 1000 px de ancho: desde 1024 px la pantalla de login pinta un panel animado con WebGL que Chromium sin interfaz renderiza por software, lo que hacía cada test varios segundos más lento (1,2 minutos para el archivo a 1280 px frente a 18 segundos), y por debajo de ese ancho la aplicación lo oculta. Las specs que necesitan un estado que el stack compartido no puede garantizar (sin conexiones, sin jobs) responden el `GET` con `mockApiGet` de `e2e/support/mock-api.ts`; el resto del tráfico es real.

### Iniciar sesión desde una spec

Better Auth permite solo 3 inicios de sesión cada 10 segundos por IP de cliente y ese límite no es configurable. Dos reglas mantienen la suite por debajo:

- `setup` es el único lugar que inicia sesión a través del proxy web. Lo hace como máximo una vez por ejecución, y ninguna mientras la sesión guardada siga siendo aceptada (consulta `GET /api/auth/get-session?disableCookieCache=true`, que verifica la base de datos en lugar de la cookie en caché), así que las ejecuciones seguidas nunca llegan al límite.
- Una spec que necesita su propio inicio de sesión (credenciales incorrectas, el usuario no admin, la guarda del límite) llama a `signInOnDirectApi` de `e2e/support/api.ts`. Hace el POST al puerto de la API (`:3000`) con un encabezado `X-Forwarded-For` único. Detrás del proxy todos los clientes comparten una dirección, porque nginx sobrescribe ese encabezado; el puerto de la API sí lo respeta, así que cada inicio de sesión tiene su propio contador y nunca toca el que usa `setup`.

Nunca cierres la sesión del admin compartido: todas las demás specs la usan. El usuario no admin se crea una vez por worker con el plugin de administración de Better Auth y se elimina cuando el worker termina.

### Specs del navegador y el límite de intentos

Better Auth también limita cualquier otra ruta de `/api/auth/*` a 100 peticiones cada 10 segundos por IP de cliente, y la aplicación web llama a `get-session` en cada página que abre. A través del proxy todos los contextos de navegador, workers y proyectos comparten una sola dirección, así que una ejecución paralela de la UI agota ese margen: la aplicación interpreta el 429 como "sin sesión" y la spec termina en la página de login, de forma aleatoria (sin el enrutado descrito abajo, `--repeat-each=3` sobre el proyecto de la UI hizo fallar 7 tests de este modo).

La suite lo evita sin simular el inicio de sesión. El fixture `context` de `e2e/support/fixtures.ts` llama a `routeAuthToOwnRateLimitBucket` (`e2e/support/browser.ts`), que repite cada petición `/api/auth/*` del navegador contra el puerto de la API con una dirección `X-Forwarded-For` propia y entrega la respuesta a la página. El formulario real habla con la API real y el navegador termina con las cookies de sesión reales (dependen del nombre de host, no del puerto). Solo se omite el salto por nginx, y solo para estas llamadas; `setup` y el proyecto de la API siguen usando las rutas de autenticación a través del proxy.

- Importa `test` de `e2e/support/fixtures`, nunca de `@playwright/test`, en cada spec de la UI.
- Una ruta que una spec agrega a su página tiene prioridad sobre esta, así que una spec todavía puede responder un inicio de sesión con una respuesta simulada (lo hacen el mensaje del límite de intentos y la falla de red).
- Una spec que inicia o cierra sesión debe usar un contexto propio (`test.use({ storageState: SIGNED_OUT })`), nunca la sesión compartida del admin.

---

## Tests de backup y restore

El proyecto `pipeline` demuestra que backup y restore funcionan de punta a punta: la API HTTP, la cola BullMQ, `pg_dump` / `mysqldump` dentro del contenedor de la API, el almacenamiento de objetos (MinIO), `pg_restore` / `mysql` y bases de datos reales en ambos extremos. Se mantiene afuera, como cualquier cliente: habla con la API y mira las bases de datos y el almacenamiento de objetos.

### Qué hace un test

Cada test trabaja con datos propios, así que el proyecto corre en paralelo y se puede repetir.

| Paso | Cómo |
|------|------|
| 1. Origen | Crea una base de datos llamada `e2e_<motor>_<rol>_<id>` en el servidor de origen y siembra dos tablas: 3000 ítems (NULL, acentos, texto CJK, un emoji, comillas y barras invertidas, un decimal) y 300 etiquetas que los referencian con una clave foránea. |
| 2. Conexión | La registra por la API como conexión `prod` (la API alcanza los servidores como `db-test-pg` y `db-test-mysql`). Un destino de restore es otra base de datos vacía registrada como `dev` o `qa`. |
| 3. Job | `POST /api/backups` o `POST /api/restores` y luego consulta el job cada 250 ms hasta que está `completed`. El plazo es de 60 s; un job que falla o no termina hace fallar el test con su estado y su `errorMessage`. |
| 4. Prueba | Un backup se prueba en el almacenamiento: el dump descargado con su URL firmada tiene el tamaño y el SHA-256 registrados, y el objeto del manifiesto describe la ejecución. Un restore se prueba en el destino: las mismas tablas, restricciones, índices y conteos de filas que el origen, y el mismo SHA-256 sobre todas las filas en orden de clave primaria. |
| 5. Limpieza | Siempre, incluso si el test falla: se cancelan los jobs sin terminar, se borran los objetos del dump y del manifiesto, se eliminan las conexiones por la API y se descartan las bases de datos. |

### Archivos de specs del pipeline

| Archivo | Cubre |
|---------|-------|
| `backup.pipeline.spec.ts` | PostgreSQL y MySQL: campos y tiempos del job, el dump servido con su URL firmada (tamaño y SHA-256), dump y manifiesto en el almacenamiento, los listados del almacenamiento, la versión del servidor en el manifiesto (defecto conocido en PostgreSQL), un backup pendiente devuelto a peticiones repetidas y luego cancelado |
| `restore.pipeline.spec.ts` | Restore a destinos `dev` y `qa` con conteos de filas y checksum de datos iguales a los del origen, restore por clave de objeto, dry run (el plan, el manifiesto, un destino intacto), restore sobre un PostgreSQL anterior a la versión 17 (D1) |
| `rules.pipeline.spec.ts` | Lo que se rechaza: restore a `prod`, un backup del otro motor, peticiones desconocidas y mal formadas, un restore sin origen (defecto conocido), el backup de una conexión que no es de producción, listar dumps |
| `backup-failure.pipeline.spec.ts` | Backups de un origen con contraseña incorrecta, un host que no se resuelve o una base de datos que no existe terminan `failed`, con un mensaje de error y sin ningún objeto en el almacenamiento |
| `observability.pipeline.spec.ts` | Un backup y un restore completados aparecen en las listas de jobs, el historial, la analítica diaria, el resumen y los totales de almacenamiento |

Un backup que falla se intenta dos veces, con 5 segundos de diferencia. El job ya se reporta `failed` tras el primer intento y el reintento lo reescribe, así que los tests de fallo esperan al segundo intento y tardan unos 6 segundos cada uno.

### Bases de datos de origen y limpieza

Los tests alcanzan los servidores desde el host, por los puertos que publica Compose: PostgreSQL en `localhost:5435` como `test_user` (superusuario), MySQL en `localhost:3307` como `root` / `root_pass123` (`test_user` solo es dueño de `testdb` y un restore de MySQL crea bases de datos de staging) y MinIO en `localhost:9000` con las credenciales `R2_*` de `.env.e2e`. `E2E_PG_PORT`, `E2E_MYSQL_PORT` y `E2E_MINIO_PORT` las cambian (ver [Variables de entorno que leen las pruebas](#variables-de-entorno-que-leen-las-pruebas)).

Las bases de datos de prueba se llaman `e2e_...` y se descartan cuando el test termina, junto con las bases de staging que un restore de MySQL deja si lo matan a medias. Una ejecución terminada a la fuerza (no con `Ctrl+C`) se salta esa limpieza y deja sus bases de datos, conexiones y objetos hasta `pnpm docker:e2e:down`. La API no tiene un endpoint que borre jobs, así que las filas de jobs permanecen (como `completed` o `failed`) mientras viva el stack; por eso `read-contracts.api.spec.ts` verifica invariantes y no conteos.

### PostgreSQL anterior a la versión 17 (D1)

La imagen de la API trae `pg_restore` 18, que no puede restaurar en un PostgreSQL anterior a la versión 17 (defecto D1). La imagen de origen por defecto es `postgres:18-alpine`, así que por defecto se ejecuta el test de restore de PostgreSQL y se omite el de D1. Para ejecutar D1, levanta el stack con un origen más antiguo, corre el proyecto y vuelve a la imagen por defecto:

```bash
pnpm docker:e2e:down                                # empezar desde un stack limpio
E2E_PG_IMAGE=postgres:16-alpine pnpm docker:e2e     # levantar con un origen PostgreSQL 16
pnpm test:e2e --project=pipeline                    # corre D1, se omite el test de restore de PostgreSQL
pnpm docker:e2e:down && pnpm docker:e2e             # volver a la imagen por defecto
```

Con PostgreSQL 16 el test de D1 pasa: el job de restore termina `failed` con `transaction_timeout` en su mensaje de error y el destino queda vacío. El test de restore de PostgreSQL se omite con un mensaje que apunta a D1; todo lo demás, restores de MySQL incluidos, se comporta como con la imagen por defecto. Cuando D1 se corrija, el test de D1 empezará a fallar, que es la señal para borrarlo junto con su fila en [Defectos conocidos](#defectos-conocidos).

---

## Suite de rendimiento

El proyecto `perf` mide qué tan rápido el stack hace backups y restores de bases de datos, cómo se comportan las colas BullMQ cuando las peticiones llegan juntas, qué tan rápido cargan las pantallas y qué tan rápido responde la API. Es un benchmark, no una prueba de comportamiento: tiene su propia configuración (`e2e/playwright.perf.config.ts`) y **nunca forma parte de `pnpm test:e2e`**. La ejecución completa por defecto tarda unos 17 minutos en la máquina de la ejecución de referencia (16 CPU y 16 GiB para Docker). Solo falla por errores funcionales (un job que falla, una tabla restaurada con un conteo de filas incorrecto, un timeout); no hay umbrales de velocidad, así que una máquina lenta nunca la pone en rojo.

### Ejecutarla

| # | Comando | Qué hace |
|---|---------|----------|
| 1 | `pnpm docker:e2e` | Levanta el stack, igual que para la suite funcional. |
| 2 | `pnpm test:e2e:perf:unit` | Pruebas unitarias de los helpers de estadística, los generadores del reporte y el lector de ajustes. No necesitan el stack. |
| 3 | `pnpm test:e2e:perf` | Ejecuta la suite completa por defecto (primero las pruebas unitarias) y escribe una carpeta de resultados. |
| 4 | `pnpm docker:e2e:down` | Detiene el stack y borra sus datos. |

Cierra primero las aplicaciones pesadas y no toques el stack mientras mide: los números solo tienen sentido en una máquina tranquila.

### Qué se mide

| Grupo | Qué mide | Spec |
|-------|----------|------|
| Throughput de dump y restore | Para PostgreSQL y MySQL en cada tamaño de conjunto de datos: el backup (espera en cola `startedAt - createdAt`, duración `completedAt - startedAt`, tiempo de pared visto por el test, tamaño del dump, throughput sobre el tamaño del origen y sobre el del dump), luego el restore de ese dump en una base `dev` nueva y vacía (espera en cola, duración, throughput) y un conteo de filas de cada tabla contra el origen. | `backup-restore.perf.spec.ts` |
| Concurrencia de BullMQ | K backups simultáneos de K conexiones distintas (K = 1, 2, 4, 6): espera en cola de cada job según su orden de arranque, duración, tiempo total (makespan) y paralelismo; y uno contra dos restores simultáneos. | `concurrency.perf.spec.ts` |
| Front-end | Cargas en frío en Chromium de la página de login (angosta y ancha), el dashboard y la página de conexiones: TTFB, DOMContentLoaded, load, FCP, LCP, bytes transferidos y peticiones hechas. | `latency-web.perf.spec.ts` |
| Latencia de la API | 100 peticiones secuenciales a cada uno de `GET /api/connections`, `GET /api/jobs/summary`, `GET /api/jobs/analytics/daily?window=7` y `GET /api/backups/history`: p50, p95 y p99. | `latency-api.perf.spec.ts` |
| Helpers | Percentiles y estadística, los generadores del reporte, el lector de ajustes y el aislamiento de las dos configuraciones. | `stats.unit.spec.ts`, `report.unit.spec.ts`, `config.unit.spec.ts` |

Todo corre en un solo worker, un test a la vez, en este orden: backup y restore, BullMQ, latencia de la API, front-end. Los casos pesados van primero para que los ligeros se midan en un sistema que ya tiene historial de jobs. Cada caso empieza con una repetición de calentamiento que se registra y queda fuera de las estadísticas, porque el primer dump de una base recién cargada paga cachés frías y la primera conexión al almacenamiento de objetos. Las duraciones salen de las marcas de tiempo que la API guarda con cada job (milisegundos), nunca de la frecuencia con que el test consulta (cada 250 ms).

### Conjuntos de datos

Cada motor recibe una base de datos generada dentro del propio servidor con SQL por conjuntos (`generate_series` en PostgreSQL; en MySQL un insert-select sobre una tabla de números que se duplica hasta ser suficientemente grande), una vez por motor y tamaño, antes de las repeticiones medidas y sin contarse en ellas. Cada valor es función del id de la fila, así que un tamaño siempre produce las mismas filas. Ambos motores reciben la misma cantidad de filas con la misma forma; los tamaños difieren un poco porque cada motor las almacena a su manera.

Son tres tablas enlazadas por claves foráneas, con índices: `perf_customers` (uuid, texto, un correo con índice único, un decimal, una marca de tiempo, un perfil JSON), `perf_orders` (4 por cliente; uuid, estado, decimal, JSON, texto; índices por cliente y por fecha) y `perf_events` (4 por pedido, o sea casi todos los bytes; un payload de 132 caracteres hecho de tres digests SHA-256 en base64, detalles JSON; un índice por pedido). El payload parece aleatorio a propósito, para que el dump no se comprima hasta desaparecer: el formato custom de PostgreSQL termina en cerca de 0,42 del tamaño del origen y el dump de MySQL, SQL en texto plano, en cerca de 0,8 a 0,9.

| Tamaño | Objetivo | Clientes | Pedidos | Eventos | Origen PostgreSQL | Origen MySQL |
|--------|----------|----------|---------|---------|-------------------|--------------|
| `small` | 10 MiB | 1.500 | 6.000 | 24.000 | 10,2 MiB | 10,1 MiB |
| `medium` | 100 MiB | 15.000 | 60.000 | 240.000 | 99,4 MiB | 94,7 MiB |
| `large` | 500 MiB | 75.000 | 300.000 | 1.200.000 | 496 MiB | 463 MiB |
| `xlarge` (opcional) | 1 GiB | 155.000 | 620.000 | 2.480.000 | 1.025 MiB | 953 MiB |

El tamaño del origen son las tablas más los índices tal como los informa el servidor (`pg_table_size` + `pg_indexes_size`; `DATA_LENGTH` + `INDEX_LENGTH`) y es lo que dividen las cifras de throughput; el tamaño del dump viene del job de backup. Los tamaños de arriba se midieron en una ejecución de referencia y `summary.md` informa los de cada ejecución. MiB son 1.048.576 bytes.

### Ajustes

Los valores por defecto son el preset `full`. Cada variable lo sobrescribe; defínelas en `.env.e2e` (hay ejemplos comentados en `.env.e2e.example`) o expórtalas en el shell, donde tienen prioridad sobre el archivo.

| Variable | Valor por defecto | Efecto |
|----------|-------------------|--------|
| `E2E_PERF_PRESET` | `full` | `quick` es una prueba de humo de todo el arnés (cerca de un minuto): ambos motores, el conjunto pequeño, 2 repeticiones, K = 1, 2, 4, 3 cargas de página y 20 peticiones a la API. |
| `E2E_PERF_ENGINES` | `postgres,mysql` | Motores a medir. |
| `E2E_PERF_SIZES` | `small,medium,large` | Tamaños de los conjuntos de datos. Agrega `xlarge` (cerca de 1 GiB) para activarlo. |
| `E2E_PERF_RUNS` | 20 small, 20 medium, 10 large, 3 xlarge | Repeticiones medidas por caso, sin contar el calentamiento. Un solo número se aplica a todos los tamaños. |
| `E2E_PERF_QUEUE_SIZE` | `medium` | Conjunto de datos de los experimentos de BullMQ. |
| `E2E_PERF_QUEUE_K` | `1,2,4,6` | Backups simultáneos, un caso por valor (de 1 a 12). |
| `E2E_PERF_QUEUE_RESTORES` | `1,2` | Restores simultáneos, un caso por valor. |
| `E2E_PERF_QUEUE_RUNS` | `5` | Repeticiones medidas por caso de BullMQ. |
| `E2E_PERF_UI_RUNS` | `20` | Cargas en frío por página (la página de login ancha usa 10 como máximo). |
| `E2E_PERF_API_REQUESTS` | `100` | Peticiones secuenciales por endpoint, tras 5 de calentamiento. |

### Variantes

Los flags y los nombres de archivo van justo después de `pnpm test:e2e:perf`, **sin** el separador `--`, como en `pnpm test:e2e`. Un nombre de archivo selecciona solo esa spec; las pruebas unitarias y `setup` se ejecutan igualmente primero.

```bash
pnpm test:e2e:perf                       # la suite completa por defecto
pnpm test:e2e:perf --list                # qué se ejecutaría, sin ejecutar nada
pnpm test:e2e:perf:unit                  # solo las pruebas unitarias de los helpers, sin stack
E2E_PERF_PRESET=quick pnpm test:e2e:perf # prueba de humo de todo el arnés
E2E_PERF_ENGINES=postgres E2E_PERF_SIZES=small,medium E2E_PERF_RUNS=5 pnpm test:e2e:perf backup-restore   # motor, tamaños y repeticiones a elección; solo la spec de backup y restore
E2E_PERF_SIZES=xlarge E2E_PERF_RUNS=1 pnpm test:e2e:perf backup-restore   # el conjunto de 1 GiB, una repetición
pnpm test:e2e:perf latency-web           # una sola spec (backup-restore, concurrency, latency-api, latency-web)
```

En PowerShell define la variable antes y bórrala después: `$env:E2E_PERF_PRESET = 'quick'; pnpm test:e2e:perf; Remove-Item Env:E2E_PERF_PRESET`.

### Resultados

Cada ejecución escribe una carpeta nueva, `e2e/perf-results/<marca de tiempo UTC>/` (ignorada por git), y nunca toca una anterior. Las specs guardan cada caso a medida que lo miden y, cuando la ejecución termina, incluso si falló, el reporter une los casos en tres archivos:

| Archivo | Contenido |
|---------|-----------|
| `results.json` | La muestra cruda de cada repetición (los calentamientos marcados con `warmup: true`), las estadísticas, el entorno (commit, versiones de Node.js, Playwright y Chromium, recursos del host y de la VM de Docker, versiones de PostgreSQL y MySQL de origen, versiones de `pg_dump` y `mysqldump` de la imagen de la API, las variables `E2E_*`), los ajustes y la definición de los conjuntos de datos con sus tamaños reales. |
| `summary.csv` | Una fila por caso y métrica, con las columnas `group,case,metric,unit,n,min,p50,p95,p99,max,mean,stddev,complete`, lista para una hoja de cálculo. |
| `summary.md` | Tablas legibles, una por grupo de métricas y con la unidad en el título, para pegar en un informe. |

Cómo leer las estadísticas:

- **p50** es la mediana; **p95** y **p99** son percentiles calculados por interpolación lineal entre los rangos más cercanos (método R-7, el que usan por defecto NumPy y `PERCENTILE.INC` de Excel); **σ** es la desviación estándar muestral (n - 1).
- Con menos de 20 muestras el p95 queda entre los dos valores más grandes, así que en la práctica es el máximo; se informa igual para que todas las tablas tengan la misma forma. Por defecto `small` y `medium` tienen 20 repeticiones, así que tienen un p95 real, y las 100 peticiones a la API dan también un p99 real; `large` tiene 10 y los casos de BullMQ 5.
- **Duración** es `completedAt - startedAt` del job; **espera en cola** es `startedAt - createdAt`; **tiempo de pared** es lo que vio el test desde su petición hasta la consulta que encontró el job completado, así que puede ser hasta 250 ms mayor que la duración. **Throughput** son MiB por segundo sobre el tamaño del origen y sobre el del dump.
- Un `*` tras un tamaño en `summary.md` (`complete` en falso en el CSV) marca un caso que se detuvo antes de su última repetición.
- Los números pertenecen a esta máquina y al MinIO local: no dicen nada del salto de red hacia Cloudflare R2.

Un ejemplo del formato (filas de la tabla "Backup duration (s)" de una ejecución de referencia; muestran la forma, no cifras con las que comparar tu máquina):

| Engine | Size | n | min | p50 | p95 | max | mean | σ |
|:---|:---|---:|---:|---:|---:|---:|---:|---:|
| PostgreSQL | medium | 20 | 1.83 | 1.85 | 2.02 | 2.36 | 1.89 | 0.12 |
| MySQL | medium | 20 | 0.77 | 0.80 | 0.82 | 0.82 | 0.80 | 0.01 |

### La escalera de BullMQ

La cola `backup` tiene concurrencia 2 y la cola `restore` concurrencia 1. Cuando se piden juntos K backups de K conexiones distintas, dos arrancan a la vez y cada job siguiente espera a un worker libre, así que la espera en cola según el orden de arranque sube un escalón (cerca de un backup) cada dos jobs y el tiempo total (de la primera petición a la última finalización) también crece por escalones, mientras el paralelismo se mantiene cerca de 2.

| K | Forma esperada |
|---|----------------|
| 1, 2 | Todo arranca a la vez: un tiempo total de un backup y esperas en cola de pocos milisegundos. |
| 4 | Dos olas: los jobs 3 y 4 esperan cerca de un backup y el tiempo total es de cerca de dos. |
| 6 | Tres olas: los jobs 5 y 6 esperan cerca de dos backups y el tiempo total es de cerca de tres. |

Con un solo worker de restore los restores son estrictamente secuenciales: de dos restores simultáneos el segundo espera al primero, así que su espera en cola es de cerca de un restore y la diferencia entre las dos finalizaciones es de cerca de un restore. Las K conexiones son K registros de conexión distintos, porque un segundo backup de la misma conexión se difiere con una espera de 30 a 300 segundos, lo que mediría esa política y no la cola; apuntan a una misma base de origen, lo que mantiene idéntica la carga de cada job. En la ejecución de referencia, PostgreSQL con K = 6 tuvo esperas en cola según el orden de arranque de 0,01, 0,01, 2,07, 2,10, 4,10 y 4,15 s (un escalón de cerca de un backup, 2 s, cada dos jobs) y un tiempo total de 6,28 s frente a 1,92 s con K = 1, con un paralelismo de 1,99; MySQL mostró los mismos escalones de cerca de 1 s. De dos restores simultáneos el segundo esperó 1,08 s en PostgreSQL y 4,49 s en MySQL, la duración de un restore, y sus finalizaciones quedaron separadas por 1,13 s y 4,37 s.

### Salvedades

- Ejecútala en una máquina tranquila: cierra las aplicaciones pesadas y no uses el stack ni corras otras suites mientras mide. Los recursos del host y de la VM de Docker se guardan en `results.json` para poder leer un resultado frente a la máquina que lo produjo.
- La primera ejecución de cada caso es un calentamiento: se conserva en `results.json` y queda fuera de toda estadística.
- El almacenamiento de objetos es MinIO en la misma VM de Docker, así que los tiempos de dump y restore excluyen el salto de red hacia Cloudflare R2.
- La página de login se mide por debajo de 1024 px (1000 x 800) porque desde 1024 px la pantalla de inicio de sesión pinta un panel animado con WebGL que Chromium sin interfaz dibuja por software; ese caso ancho se mide aparte y se etiqueta `Login (WebGL panel)`. En la ejecución de referencia no difirió del caso angosto (LCP mediano de 386 ms frente a 416 ms).
- Las filas de jobs se acumulan mientras viva el stack y los endpoints de la API responden más lento con más filas detrás (`summary.md` indica las filas que tenía cada respuesta). Para números comparables parte de un stack limpio: `pnpm docker:e2e:down` y luego `pnpm docker:e2e`.
- El conjunto `xlarge` necesita unos GB libres en la VM de Docker para el origen, el dump y el destino del restore, y tarda unos 4 minutos para una repetición de ambos motores.
- Con un PostgreSQL anterior a la versión 17 se omiten los casos de PostgreSQL, porque el restore falla ahí (D1).
- El MySQL de origen corre con su log binario desactivado (`--skip-log-bin`). Antes de ese ajuste una ejecución de rendimiento por defecto dejaba unos 7,5 GB de logs binarios en su volumen (MySQL 8 registra cada siembra y cada restore y conserva los logs 30 días); después, una ejecución rápida solo de MySQL dejó un directorio de datos de unos 200 MB, sin archivos de log binario. `pnpm docker:e2e:down` sigue borrando todos los datos.
- Una ejecución terminada a la fuerza deja sus bases de datos `e2e_...`, conexiones y dumps hasta `pnpm docker:e2e:down`.

---

## Variantes de ejecución

Pasa los flags justo después de `pnpm test:e2e`, **sin** el separador `--` (con él, pnpm reenvía el `--` y Playwright ignora el filtro de proyecto).

```bash
pnpm test:e2e --project=api                      # solo las specs de la API
pnpm test:e2e --project=pipeline                 # solo las specs de backup y restore
pnpm test:e2e --project=ui-chromium              # solo las specs del navegador
pnpm test:e2e tests/ui/connections.ui.spec.ts    # un solo archivo de la UI
pnpm test:e2e --project=ui-chromium -g "wrong password"   # tests de la UI cuyo título coincide
pnpm test:e2e tests/api/connections.api.spec.ts  # un solo archivo
pnpm test:e2e tests/pipeline/restore.pipeline.spec.ts   # un solo archivo del pipeline
pnpm test:e2e -g "login"                         # tests cuyo título coincide
pnpm test:e2e --project=api -g "test-raw"        # tests de la API cuyo título coincide
pnpm test:e2e --project=pipeline -g "MySQL"      # tests del pipeline cuyo título coincide
pnpm test:e2e --project=api --repeat-each=3      # ejecuta cada test de la API 3 veces para detectar inestabilidad
pnpm test:e2e --project=pipeline --repeat-each=3 # lo mismo para backup y restore
pnpm test:e2e --project=pipeline --workers=1     # un test del pipeline a la vez
pnpm test:e2e --project=ui-chromium --headed     # ver el navegador
pnpm test:e2e --project=ui-chromium --workers=1  # un navegador a la vez, más fácil de seguir
pnpm test:e2e --ui                               # modo UI de Playwright
pnpm test:e2e --project=ui-chromium --debug      # paso a paso con el Inspector
pnpm test:e2e:report                             # abrir el reporte HTML
```

El proyecto `setup` siempre se ejecuta primero, por lo que su test se cuenta en todas las ejecuciones. El reporte se sirve en `http://localhost:9323` (presiona `Ctrl+C` para detenerlo). Para las specs del navegador, `--headed` y `--ui` muestran lo que hace la página, `--workers=1` ejecuta un navegador a la vez y un test fallido conserva su traza y su captura en el reporte.

---

## Puntos de entrada

| Qué | Dónde | Notas |
|-----|-------|-------|
| Web + proxy de la API | `http://localhost:5173` | La API está bajo `/api`. |
| API (directa) | `http://localhost:3000` | Es el único lugar donde existe `/health`. Las specs que inician sesión la usan (ver [Iniciar sesión desde una spec](#iniciar-sesión-desde-una-spec)). |
| MinIO (S3) | `http://localhost:9000` | Consola en `http://localhost:9001`. Ingresa con `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` de `.env.e2e`. |
| PostgreSQL de origen | `localhost:5435` | Base `testdb`, usuario `test_user`, contraseña `test_pass123`. Las specs del pipeline crean aquí sus propias bases `e2e_...`. |
| MySQL de origen | `localhost:3307` | Base `testdb`, usuario `test_user`, contraseña `test_pass123`. Las specs del pipeline se conectan como `root` / `root_pass123` y crean sus propias bases `e2e_...`. |

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
| `E2E_PG_PORT` | `5435` | Puerto del host del PostgreSQL de origen, para las specs del pipeline. Mantenlo igual al que publica Compose. |
| `E2E_MYSQL_PORT` | `3307` | Puerto del host del MySQL de origen, para las specs del pipeline. |
| `E2E_MINIO_PORT` | `9000` | Puerto del host de MinIO, para las specs del pipeline. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | de `.env.e2e` | Cuenta y bucket de MinIO; las specs del pipeline los usan para mirar los objetos almacenados. |
| `E2E_PERF_PRESET`, `E2E_PERF_ENGINES`, `E2E_PERF_SIZES`, `E2E_PERF_RUNS`, `E2E_PERF_QUEUE_SIZE`, `E2E_PERF_QUEUE_K`, `E2E_PERF_QUEUE_RESTORES`, `E2E_PERF_QUEUE_RUNS`, `E2E_PERF_UI_RUNS`, `E2E_PERF_API_REQUESTS` | ver [Ajustes](#ajustes) | Qué y cuánto mide la suite de rendimiento. |

---

## Solución de problemas

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `pnpm docker:e2e` falla con `Bind for 0.0.0.0:5173 failed: port is already allocated` | Otro stack (compose de dev o prod, u otra aplicación) tiene el puerto. | Detenlo y vuelve a ejecutar. |
| `The E2E stack is not ready: ... (last result: ECONNREFUSED)` | Las pruebas se ejecutaron con el stack apagado; reintentan durante 30 segundos antes de fallar. | Ejecuta `pnpm docker:e2e` y luego las pruebas de nuevo. |
| `couldn't find env file: ...\.env.e2e` o `E2E configuration is incomplete: ... .env.e2e does not exist` | Falta `.env.e2e`. | `cp .env.e2e.example .env.e2e` |
| El inicio de sesión falla con HTTP 429 (`Too many requests`) | Más de 3 inicios de sesión en 10 segundos a través del proxy. `setup` inicia sesión una vez como máximo, así que hacen falta varias ejecuciones lanzadas en pocos segundos sin una sesión guardada válida (tras `pnpm docker:e2e:down`, o con `e2e/.auth` borrado), o una spec que inicia sesión por el proxy. | Espera 10 segundos y vuelve a ejecutar. En una spec, usa `signInOnDirectApi`. |
| Una spec de la UI termina en la página de login aunque tiene sesión, o `/api/auth/get-session` responde 429 | Más de 100 peticiones a la misma ruta de `/api/auth/*` (en la práctica `get-session`) en 10 segundos desde una sola dirección; la aplicación interpreta el 429 como sin sesión. La spec no usa el fixture `context` que le da al navegador una dirección propia. | Importa `test` de `e2e/support/fixtures`, no de `@playwright/test` (ver [Specs del navegador y el límite de intentos](#specs-del-navegador-y-el-límite-de-intentos)). |
| El inicio de sesión falla con `INVALID_ORIGIN` | `E2E_BASE_URL` usa `127.0.0.1`. | Usa `localhost`. |
| El inicio de sesión falla con `INVALID_EMAIL_OR_PASSWORD`, o el stack arranca con valores inesperados | Una variable exportada en tu shell sobrescribe `.env.e2e` (tanto para Compose como para las pruebas). | Elimina la variable en ese shell (`unset`). |
| `Expected to fail, but passed` en una spec marcada con `test.fail` | Se corrigió un defecto conocido. | Borra el `test.fail` y la fila en [Defectos conocidos](#defectos-conocidos). |
| Quedan cuentas `e2e-user-...@envault.local` tras una ejecución abortada | El usuario no admin de prueba se elimina cuando su worker termina; una ejecución cancelada se salta ese paso. | `pnpm docker:e2e:down` las borra junto con el resto de los datos. |
| Necesitas empezar de cero | Los datos de una ejecución anterior siguen en los volúmenes. | `pnpm docker:e2e:down` borra los volúmenes; el siguiente `pnpm docker:e2e` arranca vacío. |
| Los restores fallan con `unrecognized configuration parameter "transaction_timeout"` | El PostgreSQL de origen es anterior a la versión 17 y el `pg_restore` de la imagen de la API es la versión 18. | Mantén `E2E_PG_IMAGE` en la versión 17 o superior (por defecto `postgres:18-alpine`). Con un servidor más antiguo el proyecto `pipeline` omite su test de restore de PostgreSQL y ejecuta el de D1 (ver [PostgreSQL anterior a la versión 17 (D1)](#postgresql-anterior-a-la-versión-17-d1)). |
| `Cannot reach the source PostgreSQL (localhost:5435) from the host` (o el de MySQL) | El stack está apagado, o se cambió un puerto en Compose pero no en `.env.e2e`, así que las pruebas siguen mirando el valor por defecto. | Ejecuta `pnpm docker:e2e` y define `E2E_PG_PORT` / `E2E_MYSQL_PORT` en `.env.e2e`, donde los leen tanto Compose como las pruebas. |
| `Backup job ... did not complete within 60 s` (o `Restore job ...`) | El worker no terminó el job a tiempo: está atascado, o la cola está ocupada con otros jobs. El mensaje trae el último estado y error del job. | Ejecuta el test solo para ver si el stack está sano; `pnpm docker:e2e:down` y `pnpm docker:e2e` dan uno limpio. |
| Bases de datos llamadas `e2e_...` siguen en los servidores de origen tras una ejecución abortada | La limpieza corre cuando el test termina; una ejecución terminada a la fuerza se la salta. | `pnpm docker:e2e:down` las elimina junto con el resto de los datos. |
| Se rechaza un ajuste de rendimiento: `E2E_PERF_SIZES="..." is not valid` (u otra variable `E2E_PERF_*`) | El valor tiene un error de escritura o está fuera de rango. | Usa los valores de [Ajustes](#ajustes); el mensaje enumera los válidos. |
| Un caso de rendimiento falla con `Backup job ... did not complete within ... s`, o la VM de Docker se queda sin disco | El conjunto de datos es más grande de lo que la máquina puede volcar dentro del plazo (crece con el tamaño), o la VM no tiene espacio libre para el origen, los dumps y las copias del restore. | Revisa `docker system df`, libera espacio, ejecuta un tamaño menor o parte de un stack limpio con `pnpm docker:e2e:down` y `pnpm docker:e2e`. |
