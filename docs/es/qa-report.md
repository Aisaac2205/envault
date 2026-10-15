# Informe de QA — EnVault Management

> 🇬🇧 English version: [../en/qa-report.md](../en/qa-report.md)

Este informe presenta el trabajo de aseguramiento de la calidad (QA) realizado sobre EnVault con una suite de pruebas automatizadas construida con [Playwright](https://playwright.dev): qué se probó, cómo, qué se encontró, hasta qué punto se puede confiar en los resultados y qué queda pendiente. Describe la rama `feat/e2e-playwright-suite` en el commit `9902fee`, al 2026-10-15. Cada sección numerada está escrita para entenderse por sí sola, de modo que pueda copiarse aislada en otro documento.

---

## 1. Resumen

EnVault es una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL en un almacenamiento de objetos y las restaura. Su calidad se verificó con una suite automatizada escrita con Playwright, una herramienta de pruebas que envía peticiones HTTP a una API y maneja un navegador web real, ejecutada contra una copia completa de la aplicación en Docker. El trabajo se hizo para un curso universitario de QA cuya consigna era tomar un proyecto propio y escribir pruebas automatizadas para él con una herramienta a elección.

| Elemento | Resultado |
|----------|-----------|
| Suite funcional (`pnpm test:e2e`) | 256 tests en 18 archivos: 149 tests de API, 42 de backup y restore, 64 de navegador y 1 paso de inicio de sesión; entre 24,7 y 29,8 s por ejecución con 8 workers en paralelo |
| Suite de rendimiento (`pnpm test:e2e:perf`) | 55 tests: 13 mediciones, 41 tests unitarios de sus propias funciones auxiliares y 1 paso de inicio de sesión; unos 17 minutos por ejecución completa |
| Tests unitarios de caja blanca (Jest y Vitest, ya presentes en el proyecto) | API 548 tests, app web 202, landing 42 |
| Fiabilidad | 13 ejecuciones consecutivas de toda la suite funcional con distinto paralelismo y repetición: 3838 ejecuciones de tests, 0 fallos, 0 tests inestables |
| Reproducibilidad | Un clon nuevo del repositorio, preparado siguiendo al pie de la letra las instrucciones escritas, dio los mismos resultados; ninguna instrucción estaba mal |
| Defectos encontrados | 18 (D1 a D18), entre ellos un defecto de seguridad (D6), uno de protección de datos ante operaciones peligrosas (D12) y uno de integridad de datos (D15) |
| Defectos corregidos | 11, cada uno con un test que fallaba escrito antes de la corrección; 4 quedan abiertos a la espera de una decisión de producto o de diseño, 1 confirmado y a la espera de aprobación, 2 sin confirmar |
| Cobertura de código de la API (líneas) | 52,93 % antes de las correcciones, 61,18 % después |
| Tiempo de backup de una base de 500 MiB (mediana, ejecución de referencia) | PostgreSQL 8,73 s, MySQL 3,70 s |
| Tiempo de restore de la misma base (mediana, ejecución de referencia) | PostgreSQL 4,74 s, MySQL 19,86 s |

Veredicto: dentro de las condiciones probadas (una máquina Windows, el navegador Chromium y un almacenamiento de objetos simulado localmente con MinIO), la suite es fiable. Sus resultados no dependieron del orden de los tests, de la cantidad de workers en paralelo ni de la repetición, y se ejecuta desde un clon nuevo con los comandos documentados. Todavía no es evidencia para otros sistemas operativos, otros navegadores, el almacenamiento real de Cloudflare R2 ni carga elevada, y aún no se ejecuta en integración continua (CI, una ejecución automática con cada cambio).

---

## 2. Contexto y elección de la herramienta

La consigna del curso universitario de QA era tomar un proyecto propio y escribir pruebas automatizadas para él con una herramienta a elección. El proyecto elegido es EnVault, una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura. La herramienta elegida es Playwright 1.63.0, un framework de pruebas de código abierto para aplicaciones web.

Antes de este trabajo EnVault ya tenía tests unitarios de caja blanca: tests escritos por alguien que ve el código fuente, cada uno de los cuales verifica una pieza pequeña de forma aislada, con su base de datos y demás dependencias reemplazadas por imitaciones. Usan Jest en la API y Vitest en la app web y en la landing, y se mantienen. Lo que EnVault no tenía era testing de caja negra (pruebas que solo usan las interfaces públicas, HTTP y el navegador, sin mirar el código), un entorno con bases de datos reales y almacenamiento de objetos real contra el cual ejecutarlas, ni ninguna medición de rendimiento. Playwright se usó para agregar esas tres cosas.

| Motivo para elegir Playwright | Qué hizo posible en este proyecto |
|-------------------------------|-----------------------------------|
| Una sola herramienta para pruebas de API y de navegador | Los tests de API usan su cliente HTTP integrado (el contexto `request`); los de navegador manejan Chromium. Ambos comparten un mismo ejecutor, un mismo informe y las mismas funciones auxiliares. |
| Un navegador real | Las pruebas de interfaz se ejecutan en Chromium, el motor de Chrome y Edge, no en una página simulada. |
| Proyectos | Una configuración divide la suite en los proyectos `setup`, `api`, `pipeline` y `ui-chromium`, cada uno con sus propios tiempos límite; una segunda configuración contiene la suite de rendimiento para que nunca se ejecute por accidente. |
| Un solo inicio de sesión por ejecución | El proyecto `setup` inicia sesión una vez y guarda la sesión en un archivo (`storageState`); todos los demás tests la reutilizan. Era necesario porque EnVault acepta solo 3 inicios de sesión cada 10 segundos desde una misma dirección. |
| Control de la red del navegador | `page.route` responde peticiones elegidas con respuestas preparadas, para mostrar estados de error (la API inalcanzable, una lista vacía) que un entorno compartido no puede garantizar. |
| Defectos conocidos conservados como tests | `test.fail` marca un test que se espera que falle por un defecto conocido: la ejecución sigue en verde mientras el defecto existe y pasa a rojo cuando se corrige, que es la señal para quitar la marca. |
| Workers en paralelo y repetición | Los workers son procesos separados que ejecutan tests al mismo tiempo; `--workers` fija cuántos y `--repeat-each` ejecuta cada test varias veces. Ambos hicieron posible el estudio de fiabilidad de este informe. |
| Diagnóstico | Un informe HTML de cada ejecución, y una traza y una captura de pantalla guardadas por cada test fallido. |
| TypeScript | El mismo lenguaje que EnVault, de modo que los tests siguen las convenciones del código que prueban. |

Playwright no mide cobertura de código (eso sigue a cargo de Jest y Vitest) y no es una herramienta de pruebas de carga, por lo que este informe no le atribuye ninguna de las dos cosas.

---

## 3. El sistema bajo prueba

EnVault es una aplicación web autoalojada para backups de bases de datos. Un administrador registra conexiones a bases de datos (PostgreSQL y MySQL), hace backups (dumps) de las bases de producción, los guarda en un almacenamiento de objetos (Cloudflare R2 en producción, un servicio compatible con Amazon S3) y los restaura en bases de desarrollo o de QA. Un restore sobre una base de producción se rechaza por diseño, porque un restore sobrescribe el destino.

| Parte | Tecnología | Función |
|-------|------------|---------|
| API | NestJS 11 sobre Node.js, TypeScript, TypeORM | API HTTP bajo `/api`; inicio de sesión con Better Auth (sesiones por cookie); dos roles, `admin` y `user` |
| Cola | BullMQ sobre Redis | Ejecuta en segundo plano los backups (2 a la vez) y los restores (1 a la vez) |
| Herramientas de dump | `pg_dump`, `pg_restore`, `mysqldump` y `mysql` dentro del contenedor de la API | Hacen el trabajo real de backup y restore |
| Almacenamiento de objetos | Cloudflare R2 | Guarda cada dump y un manifiesto que lo describe |
| Base de datos de la aplicación | PostgreSQL | Conexiones (con contraseñas cifradas), jobs, usuarios y el registro de auditoría |
| App web | React 19 y Vite, servida por nginx | La interfaz de administración; nginx además reenvía `/api` a la API |
| Planificador | Cron jobs dentro de la API | Backups automáticos y programados |

Las partes de riesgo, y por lo tanto el foco de las pruebas, son las contraseñas de bases de datos guardadas (seguridad), el restore, que sobrescribe una base (protección ante operaciones peligrosas), y el propio dump, que solo sirve si se puede restaurar con datos idénticos (integridad). Hay más detalle en [architecture.md](architecture.md).

---

## 4. Entorno de pruebas

Todas las pruebas de este informe se ejecutan contra una copia completa de EnVault levantada con Docker Compose. El entorno es hermético: todo lo que necesita corre en la máquina local, no se llama a nada externo y cada ejecución parte del mismo estado conocido. Está definido en `docker-compose.e2e.yml`, que se agrega sobre el archivo compose de producción, y se configura con `.env.e2e`, una copia de `.env.e2e.example`.

| Servicio | Imagen | Función en las pruebas |
|----------|--------|------------------------|
| `api` | Construida desde `apps/api`, target de producción | El sistema bajo prueba |
| `web` | Construida desde `apps/web`, target de producción (nginx) | El sistema bajo prueba; el punto de entrada es `http://localhost:5173` |
| `db` | `postgres:16-alpine` | La base de datos propia de EnVault |
| `redis` | `redis:7-alpine` | Las colas de BullMQ |
| `db-test-pg` | `postgres:18-alpine` (se puede cambiar con `E2E_PG_IMAGE`) | Bases PostgreSQL de las que se hace backup y en las que se restaura |
| `db-test-mysql` | `mysql:8.0` | Bases MySQL de las que se hace backup y en las que se restaura |
| `minio` | `pgsty/minio`, fijada por digest | Almacenamiento de objetos compatible con S3, en lugar de Cloudflare R2 |
| `minio-init` | `pgsty/mc`, fijada por digest | Crea el bucket de almacenamiento una vez y termina |

| Decisión | Por qué |
|----------|---------|
| Imágenes de producción, no las de desarrollo | La configuración de desarrollo usa builds de desarrollo y carpetas de código montadas, lo que distorsionaría el comportamiento y los tiempos que se miden. |
| MinIO en lugar de Cloudflare R2 | La API tenía la dirección de R2 escrita en su código, así que no podía funcionar sin una cuenta real en la nube. Un cambio pequeño en el producto (commit `e0146d0`) agregó una variable opcional `R2_ENDPOINT`: si está definida, la API habla con esa dirección compatible con S3, y si no lo está nada cambia, de modo que producción no se ve afectada. |
| Un proyecto Compose propio (`envault-e2e`) y puertos propios | El stack de pruebas nunca puede tocar los contenedores ni los datos de otro stack; solo el puerto 5173 se comparte con el stack de desarrollo. |
| Credenciales exclusivas de pruebas | `.env.e2e.example` contiene valores creados para este entorno: no hace falta ninguna clave de la nube ni ningún secreto real. |
| Log binario de MySQL desactivado (`--skip-log-bin`) | Una ejecución completa de rendimiento había dejado unos 7,5 GB de logs de MySQL en disco. |
| Dos comandos | `pnpm docker:e2e` construye, levanta y espera a que todos los servicios estén saludables; `pnpm docker:e2e:down` elimina los contenedores y todos sus datos. |

Por qué un entorno hermético: es reproducible (cada ejecución parte del mismo estado), gratuito (sin cuenta en la nube y sin costo), seguro (no hay datos reales en juego) y apto para CI (no hay secretos que administrar). Su contrapartida: MinIO no es R2, así que los tiempos excluyen el viaje por la red hasta Cloudflare y no se prueba ningún comportamiento propio de R2. Como `R2_ENDPOINT` es opcional, una ejecución contra un bucket real de R2 solo necesita credenciales reales, no un cambio de código.

Tiempos de arranque observados: la primera construcción tarda unos 3 minutos (194,5 s); un arranque con las imágenes ya construidas tardó 24,9 s.

| Máquina usada para todos los resultados de este informe | Valor |
|---------------------------------------------------------|-------|
| Sistema operativo | Windows 11 Pro (10.0.26300), x64 |
| Procesador y memoria | AMD Ryzen 7 7700X3D, 8 núcleos y 16 hilos; 31,7 GiB de RAM |
| Docker | Docker 29.8.2, Compose v5.5.1 |
| Node.js y pnpm | Node.js 24.21.0, pnpm 10.30.0 |
| Herramienta de pruebas | Playwright 1.63.0 con Chromium |

---

## 5. Estrategia y tipos de prueba

EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura) se probó en dos niveles. Las pruebas de caja negra usan solo las interfaces públicas, HTTP y el navegador, como lo haría un usuario u otro programa, contra el entorno Docker hermético completo; se escribieron con Playwright. Las pruebas de caja blanca miran dentro del código, verifican una pieza a la vez con imitaciones en lugar de la base de datos y de los demás servicios, y ya estaban en el proyecto (Jest y Vitest).

| Tipo | Nivel | Comando | Tests | Qué verifica |
|------|-------|---------|------:|--------------|
| Tests de API | Caja negra | `pnpm test:e2e` (proyecto `api`) | 149 | Inicio de sesión, permisos, conexiones, formato de errores y la forma de los endpoints de solo lectura |
| Tests de interfaz | Caja negra | `pnpm test:e2e` (proyecto `ui-chromium`) | 64 | Login, navegación y roles, pantalla de conexiones, dashboard, direcciones desconocidas, un backup iniciado desde la pantalla Dumps |
| Pipeline de backup y restore | Caja negra, de extremo a extremo | `pnpm test:e2e` (proyecto `pipeline`) | 42 | Backups y restores reales de PostgreSQL y MySQL, con los datos verificados en ambos extremos |
| Paso de inicio de sesión | Soporte | `pnpm test:e2e` (proyecto `setup`) | 1 | Inicia sesión una vez y guarda la sesión para los demás tests |
| Rendimiento | Caja negra, medición | `pnpm test:e2e:perf` | 13 + 41 + 1 | Velocidad de backup y restore, comportamiento de la cola, tiempos de carga de páginas, latencia de la API (13 mediciones, 41 tests unitarios de las funciones auxiliares, 1 paso de inicio de sesión) |
| Tests unitarios | Caja blanca | `pnpm test`, `pnpm test:coverage` | 548 + 202 + 42 | API (Jest), app web y landing (Vitest), con cobertura de código |

Las cantidades de tests salen de `playwright test --list` sobre el commit `9902fee` (suite funcional: 256 tests en 18 archivos; suite de rendimiento: 55 tests) y, para los tests unitarios, de las ejecuciones de `pnpm test` registradas después de la última corrección de defectos (2026-10-14 y 2026-10-15).

| Archivo | Proyecto | Tests |
|---------|----------|------:|
| `setup/auth.setup.ts` | `setup` | 1 |
| `api/auth.api.spec.ts` | `api` | 2 |
| `api/authorization.api.spec.ts` | `api` | 33 |
| `api/connections.api.spec.ts` | `api` | 45 |
| `api/error-envelope.api.spec.ts` | `api` | 26 |
| `api/health.api.spec.ts` | `api` | 3 |
| `api/read-contracts.api.spec.ts` | `api` | 30 |
| `api/sign-in.api.spec.ts` | `api` | 10 |
| `pipeline/backup.pipeline.spec.ts` | `pipeline` | 11 |
| `pipeline/backup-failure.pipeline.spec.ts` | `pipeline` | 4 |
| `pipeline/observability.pipeline.spec.ts` | `pipeline` | 1 |
| `pipeline/restore.pipeline.spec.ts` | `pipeline` | 8 |
| `pipeline/rules.pipeline.spec.ts` | `pipeline` | 18 |
| `ui/connections.ui.spec.ts` | `ui-chromium` | 21 |
| `ui/dashboard.ui.spec.ts` | `ui-chromium` | 5 |
| `ui/dumps.ui.spec.ts` | `ui-chromium` | 1 |
| `ui/login.ui.spec.ts` | `ui-chromium` | 12 |
| `ui/navigation.ui.spec.ts` | `ui-chromium` | 25 |

### Tests de API

Qué hacen: llaman a la API por HTTP con el contexto de peticiones de Playwright, como lo haría cualquier programa cliente, y verifican códigos de estado y cuerpos de respuesta. Ejemplo: un test crea una conexión a una base de datos y verifica que ninguna respuesta contenga nunca su contraseña, ni tal como se escribió ni cifrada; otra tabla de tests llama a cada endpoint exclusivo de administradores sin sesión (debe responder 401, "sin sesión iniciada") y como usuario común (debe responder 403, "no permitido"). Por qué importa: la API es el contrato del que dependen todas las demás partes, y las reglas de seguridad se verifican mejor donde se aplican.

### Tests de interfaz

Qué hacen: abren la app web en un navegador Chromium real y actúan como lo haría una persona: completan formularios, hacen clic en botones, siguen enlaces. Ejemplo: un test crea una conexión PostgreSQL desde el formulario y luego confirma a través de la API que se guardó con los valores correctos; otro inicia sesión y verifica que la sesión sobreviva a una recarga de la página. Por qué importa: una API que funciona no prueba que las pantallas la usen bien; cuatro de los defectos de este informe (D8 a D11) los encontraron los tests de navegador.

### Tests del pipeline de backup y restore

Qué hacen: cada test crea su propia base de datos, la llena con 3000 filas de datos difíciles (valores vacíos, acentos, caracteres chinos, un emoji, comillas, barras invertidas, decimales) y 300 filas que las referencian, la registra en EnVault, pide un backup y espera hasta que el job esté completado. Luego descarga el dump y compara su tamaño y su SHA-256 (una huella del archivo que cambia si cambia un solo byte) con lo que registró EnVault, lo restaura en una base vacía y verifica que las tablas, las restricciones, los índices, la cantidad de filas y un SHA-256 sobre todas las filas sean iguales a los del original. Al final se borra todo, incluso si el test falla. Por qué importa: una herramienta de backup vale lo que valen sus restores, y solo una prueba de extremo a extremo (una que atraviesa todas las partes del sistema: API, cola, herramientas de dump, almacenamiento y bases de datos) puede probar que los datos vuelven idénticos.

### Tests de rendimiento

Qué hacen: miden el tiempo de backups y restores de bases generadas de unos 10 MiB, 100 MiB y 500 MiB, de varios backups simultáneos para observar la cola, de cargas en frío de páginas en Chromium y de 100 peticiones secuenciales a cuatro endpoints de la API. Tienen un comando y una configuración propios, así que nunca hacen más lenta la suite funcional, y solo fallan ante errores funcionales, nunca porque una máquina sea lenta. Por qué importa: da números de referencia para planificar capacidad y muestra dónde el sistema es lento.

### Tests unitarios de caja blanca

Qué hacen: verifican funciones, servicios y componentes uno por uno, con la base de datos, Redis y el almacenamiento reemplazados por imitaciones, y una herramienta de cobertura informa qué líneas y ramas del código ejecutaron. Por qué importa: son rápidos (unos 20 s para los tres paquetes con la caché caliente) y señalan el lugar exacto de un fallo; todas las correcciones de defectos de este trabajo, salvo un ajuste de contenedor (D2), empezaron con un test unitario nuevo.

---

## 6. Técnicas de diseño de pruebas

Las pruebas de caja negra de EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura) se diseñaron con las técnicas siguientes. Solo se listan las técnicas que realmente están presentes en la suite.

| Técnica | Qué significa | Dónde se usa |
|---------|---------------|--------------|
| Tests guiados por tablas | Un mismo cuerpo de test se ejecuta sobre una tabla de entradas, así cada caso es una fila y un caso faltante salta a la vista | `authorization.api.spec.ts`: un test por endpoint de administrador, 401 sin sesión y 403 para un usuario común; las tablas de "no encontrado" y de formato de errores de `error-envelope.api.spec.ts` |
| Clases de equivalencia y valores límite | Las entradas se agrupan en clases que deberían comportarse igual, y se prueban los valores en los límites o justo fuera de ellos | Validación de conexiones: puerto 0, un puerto mayor que 65535, un puerto fraccionario o no numérico, un nombre de más de 100 caracteres, un motor o entorno desconocido, un campo inesperado |
| Matriz de autorización por rol | Cada acción se prueba sin sesión, como usuario común y como administrador | API (tablas de 401 y 403) e interfaz (qué enlaces ve un usuario común y qué direcciones lo redirigen) |
| Pruebas negativas | Entradas inválidas u hostiles que deben rechazarse de forma limpia | Contraseña incorrecta, email desconocido, cookie de sesión alterada, cuerpo que no es JSON, un host desconocido, un puerto cerrado, un restore sobre producción |
| Transiciones de estado de los jobs | Un job debe pasar por estados válidos en un orden válido | Un backup o restore pasa de pendiente a completado o fallido; sus marcas de tiempo cumplen `createdAt <= startedAt <= completedAt`; un backup pendiente pedido otra vez devuelve el mismo job y se puede cancelar |
| Verificaciones de integridad de datos | El resultado se compara con una referencia independiente, no simplemente se acepta | SHA-256 del dump descargado frente al registrado; cantidad de filas y un SHA-256 sobre todas las filas de la base restaurada frente a la de origen |
| Aislamiento de los tests | Los tests nunca dependen unos de otros ni de datos sobrantes | Nombres únicos en cada test, limpieza que siempre se ejecuta, una base de datos por test del pipeline; esto es lo que permite las ejecuciones en paralelo |
| Dobles de prueba en el navegador | Una respuesta preparada reemplaza a una real, solo donde el estado real no se puede garantizar | `page.route` devuelve una lista vacía, un error de límite de intentos o un fallo de red; todo el resto del tráfico es real |
| Un inicio de sesión por ejecución | La sesión se crea una vez y se comparte | El proyecto `setup` la guarda con `storageState`, porque EnVault acepta solo 3 inicios de sesión cada 10 segundos desde una misma dirección |
| Defectos conocidos como tests ejecutables | Un test afirma el comportamiento correcto y se marca como fallo esperado | `test.fail` en los 4 tests de D8; hasta que se corrija el defecto, Playwright los cuenta como pasados |
| Verificar que los tests pueden fallar | Se rompe a propósito el código o la expectativa para probar que el test lo detecta | Mientras se escribían las suites de API, interfaz, pipeline y rendimiento se rompieron expectativas a propósito (por ejemplo una suma de verificación o un estado incorrectos); cada corrección de defecto se verificó restaurando el código anterior y viendo fallar los tests nuevos |

---

## 7. Defectos encontrados

Escribir y ejecutar las pruebas de EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura) sacó a la luz 18 defectos, numerados de D1 a D18 en el orden en que se encontraron. La severidad se muestra solo donde se registró una al encontrar el defecto; los demás no se calificaron formalmente. Los commits están en la rama `feat/e2e-playwright-suite`.

| Id | Defecto | Severidad (según el registro) | Cómo se encontró | Estado |
|----|---------|-------------------------------|------------------|--------|
| D1 | Los restores sobre un PostgreSQL anterior a la versión 17 fallan: la imagen de la API incluye `pg_restore` 18, que aborta con `SET transaction_timeout` | Sin calificar | Al construir el entorno de pruebas | Abierto: requiere una decisión de producto |
| D2 | El healthcheck del contenedor web consulta `localhost`, que resuelve a IPv6, mientras nginx escucha solo en IPv4, así que el contenedor figura como no saludable | Sin calificar | Al construir el entorno de pruebas | Corregido en `7dadbc2` |
| D3 | El límite de inicios de sesión (3 cada 10 segundos por dirección) está fijo en el código y no se puede configurar | Sin calificar | Al construir el entorno de pruebas | Abierto: requiere una decisión de diseño |
| D4 | El código del dashboard llamaba a `/api/health`, una dirección que la API no sirve | Sin calificar | Lectura del código, confirmado por los tests de API | Corregido en `83627f6` (se eliminó el código sin uso; el health sigue siendo interno) |
| D5 | Siguen apareciendo líneas de log de depuración en producción | Sin calificar | Al construir el entorno de pruebas (logs de los contenedores) | Corregido en `ab7152c` |
| D6 | Al actualizar una conexión, la respuesta devolvía su contraseña de base de datos descifrada | Seguridad (calificado como crítico por una revisión automatizada) | Tests de API | Corregido en `7cb0f2c` |
| D7 | Un id que no es un UUID llegaba a la base de datos y provocaba un error 500 en lugar de un 400 | Sin calificar | Tests de API | Corregido en `de1557a` |
| D8 | A un usuario común se le ofrecen cuatro pantallas cuyos datos la API rechaza (403), y ve ceros o una carga que nunca termina, sin ningún mensaje | Sin calificar (candidato: intención de producto por confirmar) | Tests de interfaz | Abierto: requiere una decisión de producto; 4 tests marcados con `test.fail` |
| D9 | Una dirección desconocida mostraba la página de error para desarrolladores del enrutador | Sin calificar | Tests de interfaz | Corregido en `4741c9d` |
| D10 | El mensaje de latencia tras probar una conexión aparecía en español en la interfaz en inglés | Sin calificar | Tests de interfaz | Corregido en `999b710` |
| D11 | Si la API no responde al iniciar sesión, el botón queda en "Signing in..." para siempre, sin ningún mensaje | Sin calificar | Tests de interfaz | Corregido en `00b4e11` |
| D12 | Una petición de restore que no indicaba ningún backup de origen se aceptaba y usaba un backup arbitrario | Protección ante operaciones peligrosas (safety) | Tests del pipeline | Corregido en `5c1fc99` |
| D13 | Todos los manifiestos de backup de PostgreSQL registraban la versión del servidor como `unknown` | Sin calificar | Tests del pipeline | Corregido en `3e887e8` |
| D14 | Un backup que va a reintentarse figura como `failed` durante unos 5 segundos antes de que el reintento lo reescriba | Sin calificar (candidato) | Tests del pipeline | Abierto: requiere una decisión de diseño |
| D15 | Renombrar una conexión MySQL cambiaba su motor a PostgreSQL sin aviso | Integridad de datos | Lectura del código durante la primera tanda de correcciones, luego confirmado en ejecución | Corregido en `23eedc4` |
| D16 | Dos campos `connectionId` se validan como texto, no como UUID | Sin calificar (candidato) | Lectura del código durante las correcciones | Sin confirmar: las verificaciones parciales no encontraron error y un caso no fue concluyente |
| D17 | Renombrar un backup programado activo borraba su próxima ejecución y desactivaba su programación | Integridad de datos y de la programación | Lectura del código durante la corrección de D15, luego confirmado en ejecución | Confirmado, a la espera de la aprobación del dueño para corregirlo |
| D18 | Las actualizaciones parciales podrían aceptar `null` en campos obligatorios | Sin calificar (candidato) | Lectura del código durante las correcciones | Sin confirmar, a la espera de aprobación para verificarlo |

Resumen: 11 corregidos (D2, D4, D5, D6, D7, D9, D10, D11, D12, D13, D15), 4 abiertos a la espera de una decisión de producto o de diseño (D1, D3, D8, D14), 1 confirmado y a la espera de aprobación (D17) y 2 sin confirmar (D16, D18). La cantidad de tests marcados como fallo esperado bajó de 17 a 4 (solo queda D8).

Cómo se hizo cada corrección (desarrollo guiado por pruebas, TDD: el test se escribe antes que la corrección):

1. Escribir un test unitario que reproduzca el defecto y verlo fallar (rojo). Para D2, un ajuste de contenedor, la verificación que fallaba era el propio entorno de pruebas negándose a arrancar.
2. Corregir el código y ver pasar el test (verde).
3. Convertir el test de Playwright correspondiente de `test.fail` en un test normal, o agregar uno nuevo.
4. Ejecutar los tests unitarios del paquete, el verificador de tipos y el linter; luego reconstruir el entorno Docker y ejecutar toda la suite de Playwright.
5. Verificación por mutación: volver a poner el código anterior, defectuoso, y confirmar que los tests nuevos fallan; luego restaurar la corrección. Esto prueba que los tests detectan de verdad el defecto.

| Defecto | Commit de la corrección | Verificación por mutación (código anterior restaurado) |
|---------|-------------------------|--------------------------------------------------------|
| D6 | `7cb0f2c` | Fallaron 5 de 18 tests del repositorio |
| D12 | `5c1fc99` | Fallaron 5 de 13 tests de validación de la petición |
| D7 | `de1557a` | Fallaron 16 de 114 tests sobre 8 controladores |
| D13 | `3e887e8` | Falló 1 de 37 tests |
| D4 | `83627f6` | Fallaron los 2 tests de guarda nuevos |
| D5 | `ab7152c` | Fallaron 3 de 11 tests de niveles de log (con un sustituto que habilita todos los niveles) |
| D11 | `00b4e11` | Fallaron 3 de 6 tests de la página de inicio de sesión |
| D9 | `4741c9d` | Fallaron 5 de 18 tests de rutas (con la ruta comodín renombrada) |
| D10 | `999b710` | Falló 1 de 3 tests de la página de conexiones |
| D2 | `7dadbc2` | Antes de la corrección el entorno de pruebas se negaba a arrancar con `envault-e2e-web-1 is unhealthy` |
| D15 | `23eedc4` | Fallaron 3 de 36 tests de conexiones, y 1 de 8 tests del repositorio |

Por qué algunos defectos siguen abiertos: D1 depende de qué versiones de PostgreSQL decida soportar EnVault (el entorno de pruebas usa PostgreSQL 18 y un test dedicado ejecuta D1 contra PostgreSQL 16); D3 es el valor por defecto fijo de la biblioteca de inicio de sesión, y hacerlo configurable es una decisión de diseño de seguridad; D8 depende de si esas pantallas están pensadas para usuarios comunes (si son solo para administradores, la corrección es ocultarlas); D14 depende de cómo deba informarse un job que está por reintentarse. D17 se confirmó después de cerrada la lista aprobada de correcciones y espera la aprobación del dueño; D16 y D18 son sospechas surgidas de leer el código que no se han demostrado. Los tests de D1 y D8 se mantienen en la suite para que la ejecución cambie de estado cuando se corrijan. Hay más detalle en [e2e-testing.md](e2e-testing.md#defectos-conocidos).

---

## 8. Cobertura de caja blanca

La cobertura de código es la proporción del código que los tests unitarios realmente ejecutan: sentencias (instrucciones), ramas (cada resultado de un `if`, un `switch` o un operador lógico), funciones y líneas. EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura) la mide con `pnpm test:coverage` sobre sus tres paquetes: la API (Jest, con el contador Istanbul) y la app web y la landing (Vitest, con el contador V8). La línea base se tomó el 2026-10-13 (commit `e1612c4`), antes de cualquier corrección; la segunda medición el 2026-10-14 (commit `23eedc4`), después de las once correcciones. Cada corrección agregó tests unitarios.

| Paquete | Tests antes → después | Sentencias | Ramas | Funciones | Líneas |
|---------|-----------------------|-----------:|------:|----------:|-------:|
| API | 365 → 548 | 52,9 % → 61,14 % | 40,89 % → 43,8 % | 38,04 % → 49,49 % | 52,93 % → 61,18 % |
| App web | 171 → 202 | 26,44 % → 33,29 % | 27,28 % → 31,79 % | 24,05 % → 30,77 % | 27,91 % → 34,91 % |
| Landing | 42 → 42 | 10,19 % → 10,19 % | 7,88 % → 7,88 % | 26,78 % → 26,78 % | 10 % → 10 % |

Los números son deterministas (una ejecución repetida dio resultados idénticos), y la ejecución desde un clon limpio del 2026-10-15 reprodujo exactamente las cifras "después" de sentencias y de líneas.

Qué significan los números: alrededor de seis décimas del código de la API, un tercio de la app web y una décima parte de la landing se ejecutan bajo tests unitarios. Las correcciones no tocaron la landing, así que no cambió.

Qué no significan:

- La cobertura dice qué código se ejecutó, no si se comportó correctamente. En la línea base, la línea donde estaba D12 se ejecutó 18 veces bajo tests unitarios y aun así ocultaba el defecto, porque todos los tests aportaban la entrada que lo evita.
- Los dos contadores cuentan de forma distinta, así que cada paquete debe compararse con su propia historia, no con otro paquete.
- La cifra de la landing deja fuera sus 22 archivos `.astro`, que Vitest no mide, y se omitieron cuatro archivos de tests de integración de la API que necesitan una base de datos en ejecución, de modo que los repositorios que prueban quedan subcontados.
- En la línea base las áreas menos cubiertas eran la estrategia de restore de MySQL (0 % de líneas), el módulo de conexiones de la API (14 % de líneas) y varias pantallas completas de la app web (limpieza, usuarios, conexiones, cron jobs, entre 0 % y 6 %).

La suite de caja negra encontró defectos que la cobertura no podía mostrar: D6 estaba en un módulo cuyo servicio y cuyo controlador no tenían ningún test unitario, y la línea donde estaba D13 nunca se había ejecutado bajo tests unitarios. Los dos tipos de pruebas se complementan. Las tablas completas, por área y por archivo, están en [testing-coverage.md](testing-coverage.md).

---

## 9. Resultados de rendimiento

La suite de rendimiento de EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura) mide el tiempo de backups y restores, de la cola de jobs, de la carga de páginas y de las respuestas de la API contra el entorno Docker hermético, con el almacenamiento de objetos a cargo de MinIO en la misma máquina. La ejecución de referencia que se usa aquí se tomó el 2026-10-13 (UTC) en el commit `490f42eba8` más el trabajo de la suite de rendimiento todavía sin commitear (luego commiteado como `235b64d`). Eso fue antes de las correcciones de defectos y antes de que se desactivara el log binario de MySQL en el entorno de pruebas; este informe no afirma nada sobre si esos cambios afectan las cifras.

Cómo leer las cifras:

- n es la cantidad de repeticiones medidas; la primera repetición de cada caso es de calentamiento y se deja fuera.
- p50 es la mediana: la mitad de las repeticiones fue más rápida. p95 es el percentil 95: el 95 % de ellas quedó en ese valor o por debajo. Con menos de 20 repeticiones, p95 está cerca del máximo.
- La duración es el tiempo que tardó el job una vez iniciado; la espera en cola es el tiempo entre la petición y el inicio del job. El throughput es el tamaño de la base dividido por la duración, en MiB por segundo (1 MiB = 1.048.576 bytes).

| Entorno de la ejecución de referencia | Valor |
|---------------------------------------|-------|
| Host | Windows 11 x64, AMD Ryzen 7 7700X3D (16 hilos), 31,7 GiB |
| Máquina virtual de Docker | 16 CPU, 15,5 GiB, Docker 29.8.2 |
| Software | Node.js 24.21.0, Playwright 1.63.0, Chromium 153.0.8010.12 |
| Bases de datos | PostgreSQL 18.6, MySQL 8.0.46 |
| Almacenamiento de objetos | MinIO en la misma máquina virtual de Docker (no Cloudflare R2) |

Los conjuntos de datos son tres tablas relacionadas (clientes, 4 pedidos por cliente, 4 eventos por pedido) generadas dentro de cada base con índices y claves foráneas; los datos de los eventos parecen aleatorios para que los dumps no se compriman hasta desaparecer.

| Motor | Tamaño | Filas (clientes / pedidos / eventos) | Base (MiB) | Dump, p50 (MiB) |
|-------|--------|--------------------------------------|-----------:|----------------:|
| PostgreSQL | small | 1.500 / 6.000 / 24.000 | 10,2 | 4,2 |
| PostgreSQL | medium | 15.000 / 60.000 / 240.000 | 99,4 | 41,9 |
| PostgreSQL | large | 75.000 / 300.000 / 1.200.000 | 496,3 | 209,6 |
| MySQL | small | 1.500 / 6.000 / 24.000 | 10,1 | 8,0 |
| MySQL | medium | 15.000 / 60.000 / 240.000 | 94,7 | 81,2 |
| MySQL | large | 75.000 / 300.000 / 1.200.000 | 463,1 | 408,7 |

Backup y restore, un job a la vez:

| Motor | Tamaño | n | Backup p50 (s) | Backup p95 (s) | Backup MiB/s (p50) | Restore p50 (s) | Restore p95 (s) | Restore MiB/s (p50) |
|-------|--------|--:|---------------:|---------------:|-------------------:|----------------:|----------------:|--------------------:|
| PostgreSQL | small | 20 | 0,29 | 0,30 | 35,2 | 0,18 | 0,18 | 57,6 |
| PostgreSQL | medium | 20 | 1,85 | 2,02 | 53,9 | 1,01 | 1,15 | 98,4 |
| PostgreSQL | large | 10 | 8,73 | 9,14 | 56,9 | 4,74 | 4,93 | 104,7 |
| MySQL | small | 20 | 0,14 | 0,15 | 70,5 | 0,91 | 0,93 | 11,1 |
| MySQL | medium | 20 | 0,80 | 0,82 | 118,2 | 4,14 | 4,28 | 22,9 |
| MySQL | large | 10 | 3,70 | 3,80 | 125,2 | 19,86 | 20,65 | 23,3 |

Con un job solo, la espera mediana en cola es de 5 ms para un backup y de 2 ms para un restore. La suite verifica que cada tabla restaurada tenga la misma cantidad de filas que su origen, y ningún caso falló. El paso más lento es el restore de MySQL, unos 23 MiB/s frente a unos 125 MiB/s del backup de MySQL; relajar la configuración de escritura a disco de la base lo cambió apenas un 5 %, así que no es la escritura a disco lo que lo limita.

La cola: EnVault ejecuta como máximo 2 backups y 1 restore al mismo tiempo. Para mostrarlo se pidieron juntos K backups de K conexiones distintas (conjunto medium). El makespan es el tiempo desde la primera petición hasta la última finalización.

| Backups simultáneos (K) | Makespan PostgreSQL p50 (s) | Espera en cola PostgreSQL por orden de inicio, mediana (s) | Makespan MySQL p50 (s) |
|------------------------:|----------------------------:|------------------------------------------------------------|-----------------------:|
| 1 | 1,92 | 0,01 | 0,87 |
| 2 | 1,99 | 0,01; 0,01 | 0,97 |
| 4 | 4,11 | 0,01; 0,01; 2,03; 2,04 | 2,00 |
| 6 | 6,28 | 0,01; 0,01; 2,07; 2,10; 4,10; 4,15 | 3,04 |

La espera sube un escalón (más o menos un backup) cada dos jobs, que es la concurrencia de 2 vista desde afuera. De dos restores simultáneos, el segundo esperó 1,08 s en PostgreSQL y 4,49 s en MySQL, la duración de un restore, lo que confirma que los restores se ejecutan de a uno.

Páginas, abiertas en frío en Chromium (un perfil de navegador nuevo en cada carga). FCP (first contentful paint) es el momento en que aparece el primer contenido; LCP (largest contentful paint), el momento en que aparece el contenido principal.

| Página | Ventana | n | Load p50 (ms) | FCP p50 (ms) | LCP p50 (ms) | LCP p95 (ms) | Transferido (KiB) | Peticiones |
|--------|---------|--:|--------------:|-------------:|-------------:|-------------:|------------------:|-----------:|
| Login | 1000x800 | 20 | 46 | 380 | 416 | 420 | 498 | 48 |
| Login (panel animado) | 1280x720 | 10 | 51 | 386 | 386 | 396 | 498 | 48 |
| Dashboard | 1280x720 | 20 | 50 | 140 | 488 | 584 | 625 | 56 |
| Conexiones | 1280x720 | 20 | 48 | 132 | 428 | 456 | 500 | 49 |

Latencia de la API, 100 peticiones secuenciales por endpoint a través del proxy web, medida por el cliente hasta leer el cuerpo completo:

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Filas en la respuesta |
|----------|---------:|---------:|---------:|----------------------:|
| `GET /api/connections` | 3,4 | 4,3 | 6,2 | 0 |
| `GET /api/jobs/summary` | 3,4 | 4,0 | 8,1 | - |
| `GET /api/jobs/analytics/daily?window=7` | 3,9 | 4,7 | 6,3 | 7 |
| `GET /api/backups/history` | 4,9 | 5,6 | 6,0 | 264 |

Repetibilidad de las mediciones: dos ejecuciones completas durante el desarrollo coincidieron dentro de un 4 % en el throughput mediano, de un 0,7 % en la duración del backup de PostgreSQL y de un 12 % en los makespans de la cola. Una ejecución completa tarda unos 17 minutos; se inicia con `pnpm test:e2e:perf` y escribe `results.json`, `summary.csv` y `summary.md` en una carpeta nueva dentro de `e2e/perf-results/`. El método completo está en [e2e-testing.md](e2e-testing.md#suite-de-rendimiento).

---

## 10. Evidencia de fiabilidad

Una suite de pruebas solo sirve si se puede confiar en su resultado: una ejecución en rojo debe significar un problema real, y una en verde no debe ser cuestión de suerte. Un test inestable (flaky) es el que pasa o falla sobre el mismo código sin ningún cambio, casi siempre por tiempos, datos compartidos o el orden de los tests. Para medirlo, toda la suite funcional de Playwright de EnVault (256 tests: API, navegador y backup/restore) se ejecutó 13 veces seguidas el 2026-10-15, en el commit `9902fee`, contra un único entorno Docker hermético levantado una sola vez con `pnpm docker:e2e` (24,9 s con las imágenes ya construidas). Los reintentos están en 0 a propósito: Playwright puede volver a ejecutar automáticamente un test fallido, lo que ocultaría un test inestable, así que aquí un solo fallo pone la ejecución en rojo. Por defecto Playwright usó 8 workers (procesos en paralelo) en esta máquina.

| Ejecución | Comando | Por qué esta variante | Resultado | Tiempo de Playwright |
|-----------|---------|-----------------------|-----------|----------------------|
| 1-10 | `pnpm test:e2e`, 10 veces seguidas | Uso normal; todas las ejecuciones reutilizan el mismo almacén de datos, así que los restos de una romperían la siguiente | Cada una: 255 passed, 1 skipped, 0 failed | 29,8; 26,0; 25,9; 25,9; 24,7; 24,8; 25,4; 25,9; 25,7; 25,6 s |
| 11 | `pnpm test:e2e --workers=1` | Un test a la vez, en orden fijo: expone tests que solo pasan porque otro test se ejecutó antes o en paralelo | 255 passed, 1 skipped | 1,9 min |
| 12 | `pnpm test:e2e --workers=16` | El doble del paralelismo por defecto: expone tests que chocan sobre datos compartidos o dependen de los tiempos | 255 passed, 1 skipped | 25,8 s |
| 13 | `pnpm test:e2e --repeat-each=3` | Cada test tres veces en la misma ejecución: expone tests que fallan de vez en cuando | 766 tests (el paso de inicio de sesión una vez, más 3 x 255), 763 passed, 3 skipped | 1,1 min |

Totales: 13 ejecuciones, 3838 ejecuciones de tests, 3823 pasadas, 15 omitidas por diseño, 0 fallos, 0 tests inestables. El test omitido es siempre el mismo: la verificación de D1, que solo se ejecuta cuando el PostgreSQL de origen es anterior a la versión 17. Los 4 tests del defecto D8 están marcados con `test.fail` (fallo esperado) y Playwright los cuenta como pasados mientras el defecto exista. La primera ejecución fue la más lenta porque sus cachés estaban frías. Con 16 workers la suite no fue más rápida que con 8, así que con 8 workers su tiempo ya no está limitado por la cantidad de workers; el objetivo de esa ejecución era mostrar que más presión en paralelo no provoca fallos. Tras el estudio el entorno se eliminó con `pnpm docker:e2e:down` y no quedaron contenedores, volúmenes ni redes (0).

Qué muestra esto: los resultados no dependen del orden de los tests, del paralelismo ni de la repetición, y los tests limpian lo que crean, ya que 13 ejecuciones compartieron un mismo entorno sin interferir. Esto coincide con la historia del trabajo: durante el desarrollo la suite completa ya había superado más de 30 ejecuciones completas consecutivas con conteos idénticos, y cada corrección de defecto se verificó por mutación (el código anterior restaurado, los tests nuevos vistos fallar, la corrección restaurada).

Segunda verificación, un clon limpio (2026-10-15, de 13:55 a 14:00, UTC-6): para probar que el repositorio y su documentación bastan por sí solos, la rama se clonó con `git clone --branch feat/e2e-playwright-suite` en una carpeta nueva y se siguió al pie de la letra el "Camino rápido" de [e2e-testing.md](e2e-testing.md).

| Paso | Comando | Resultado | Tiempo |
|------|---------|-----------|--------|
| 1 | `cp .env.e2e.example .env.e2e` | Hecho | menos de 1 s |
| 2 | `pnpm install` | Hecho | 27,6 s |
| 3 | `pnpm e2e:install` | Hecho (Chromium ya estaba en la máquina) | 1,0 s |
| 4 | `pnpm docker:e2e` | Entorno saludable | 80,8 s |
| 5 | `pnpm test:e2e` | 255 passed, 1 skipped | 26,2 s |
| 6 | `pnpm docker:e2e:down` | Hecho; quedaron 0 contenedores, volúmenes y redes | 2,5 s |
| - | `pnpm test` | API: 61 archivos de tests pasados y 4 omitidos (necesitan una base de datos en ejecución), 548 tests pasados y 32 omitidos; app web: 38 archivos pasados; landing: 4 archivos pasados | 56,3 s |
| - | `pnpm test:coverage` | API 61,14 % de sentencias y 61,18 % de líneas; app web 33,29 % y 34,91 %; landing 10,19 % y 10 %, idénticos a las cifras documentadas | 59,6 s |

Ningún paso documentado estaba mal. El límite de esta verificación: se hizo en la misma máquina física, así que el almacén de paquetes, la descarga de Chromium y las imágenes base de Docker ya estaban presentes. Prueba que el repositorio más su documentación se bastan a sí mismos, no lo que cuesta una primera instalación en una máquina nueva (una primera construcción con `pnpm docker:e2e` tardó unos 3 minutos, 194,5 s, en una etapa anterior del proyecto).

---

## 11. Limitaciones y amenazas a la validez

Los resultados de este trabajo de QA sobre EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura, probada con Playwright, Jest y Vitest) valen bajo las condiciones que se listan aquí. Una amenaza a la validez es un motivo por el que un resultado podría no cumplirse en otro contexto.

| Limitación | Consecuencia |
|------------|--------------|
| Una sola máquina, con Windows | Todos los resultados vienen de una computadora con Windows 11 y Docker Desktop. No se probaron hosts Linux o macOS ni máquinas más lentas. |
| Solo Chromium | No se probaron Firefox ni WebKit (Safari), ni tamaños de pantalla de móviles. |
| Todavía sin CI | La suite se ejecuta en una máquina de desarrollo; nada la ejecuta automáticamente con cada cambio. |
| MinIO en lugar de Cloudflare R2 | No se cubren el comportamiento de almacenamiento propio de R2 ni el viaje por la red hasta él; las cifras de rendimiento excluyen ese viaje. |
| Rendimiento medido antes de las correcciones | La ejecución de referencia es anterior a las once correcciones de defectos y al cambio que desactivó el log binario de MySQL. No se repitió después. |
| Una sola ejecución de referencia de rendimiento | Las cifras vienen de una ejecución completa (con una segunda usada solo para verificar la repetibilidad) en una máquina; son valores de referencia, no garantías. |
| D8 sigue como fallo esperado | Cuatro tests documentan un defecto abierto en lugar de verificar un comportamiento que funciona. |
| Clon limpio en una máquina con cachés | La verificación con un clon limpio reutilizó cachés que ya estaban en la máquina, así que no mide una primera instalación. |
| Sin pruebas de carga ni de estrés | No se probó el comportamiento con muchos usuarios simultáneos; la prueba de la cola usó como máximo 6 backups simultáneos. |
| Sin pruebas de accesibilidad ni visuales | No se verificaron el soporte de lectores de pantalla, el contraste ni las regresiones visuales. |
| Los tests son código nuevo | El propio código de las pruebas tuvo una revisión independiente limitada; algunas mejoras de las funciones auxiliares sugeridas por una revisión automatizada siguen pendientes. |
| Tablas de cobertura en parte antiguas | Las tablas de cobertura por área y por archivo son de la línea base; después de las correcciones solo se volvieron a medir los totales. |

---

## 12. Cómo reproducir los resultados

Todos los resultados de este informe de QA sobre EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura) se pueden reproducir desde el repositorio con los comandos siguientes, ejecutados desde su raíz. Requisitos: Node.js 22 o posterior, pnpm 10 o posterior, Docker con Compose, y los puertos 5173, 3000, 5435, 3307, 9000 y 9001 libres.

| Objetivo | Comandos |
|----------|----------|
| Preparar una sola vez | `cp .env.e2e.example .env.e2e`, `pnpm install`, `pnpm e2e:install` |
| Levantar el entorno de pruebas | `pnpm docker:e2e` |
| Ejecutar la suite funcional | `pnpm test:e2e` (esperado: 255 passed, 1 skipped) |
| Repetir el estudio de fiabilidad | `pnpm test:e2e` diez veces, luego `pnpm test:e2e --workers=1`, `pnpm test:e2e --workers=16` y `pnpm test:e2e --repeat-each=3` |
| Abrir el informe HTML de la última ejecución | `pnpm test:e2e:report` |
| Ejecutar la suite de rendimiento | `pnpm test:e2e:perf` (unos 17 minutos; resultados en `e2e/perf-results/`) |
| Detener y borrar el entorno | `pnpm docker:e2e:down` |
| Tests unitarios y cobertura (no hace falta Docker) | `pnpm test`, `pnpm test:coverage` |

Las instrucciones completas, las variantes de cada comando y la tabla de solución de problemas están en [e2e-testing.md](e2e-testing.md) y [testing-coverage.md](testing-coverage.md).

---

## 13. Conclusiones y próximos pasos

Conclusiones del trabajo de QA sobre EnVault (una aplicación autoalojada que hace backups de bases de datos PostgreSQL y MySQL y las restaura), probada con una suite de caja negra en Playwright y los tests unitarios existentes en Jest y Vitest:

- Playwright alcanzó para cubrir la API, la interfaz en el navegador y todo el camino de backup y restore con una sola herramienta, y para medir el rendimiento con esa misma herramienta.
- La suite de caja negra encontró 18 defectos; 11 se corrigieron con un test escrito primero, entre ellos un defecto de seguridad (D6), uno de protección ante operaciones peligrosas (D12) y uno de integridad de datos (D15); D6 y D12 estaban en código que los tests unitarios no alcanzaban o no ejecutaban con la entrada que lo rompe.
- La suite demostró ser estable: 3838 ejecuciones de tests en 13 ejecuciones con distinto paralelismo y repetición, 0 fallos y 0 tests inestables, y el mismo resultado desde un clon limpio.
- Las correcciones subieron la cobertura por tests unitarios de la API del 52,93 % al 61,18 % de las líneas y la de la app web del 27,91 % al 34,91 %.
- La referencia de rendimiento muestra backups de una base de 500 MiB en menos de 9 s y deja a la vista el paso más lento, el restore de MySQL (unos 23 MiB/s).

Próximos pasos:

1. Ejecutar la suite en CI con cada cambio, idealmente sobre Linux, para eliminar la limitación de una sola máquina.
2. Decidir sobre los defectos abiertos D1, D3, D8 y D14, y aprobar o rechazar la corrección de D17 y las verificaciones de D16 y D18.
3. Repetir la ejecución de rendimiento sobre el código actual, y una vez contra un bucket real de Cloudflare R2.
4. Extender las pruebas de navegador a Firefox y WebKit, y agregar verificaciones de accesibilidad.
5. Agregar tests unitarios donde la cobertura de la línea base era más débil: la estrategia de restore de MySQL, el módulo de conexiones y las pantallas web de limpieza, usuarios y cron jobs.
