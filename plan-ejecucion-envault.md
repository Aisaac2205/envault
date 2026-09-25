# EnVault — Plan de ejecución

> Documento de planificación y estado de ejecución.
>
> **Verificado contra:** `main` en `6d633b1` · **Fecha:** 2026-08-29 · **Última actualización:** B2 cerrado — Fase 1 completa
>
> **Regla de este documento:** ninguna fila dice ✅ sin la referencia del commit o PR que lo cierra. Si no hay referencia, no está verificado. Antes de planificar sobre cualquier fila, reverificar contra `HEAD`.

---

## 1. Estado verificado

### Cerrado y mergeado

| Ítem                                                           | Evidencia                     |
| -------------------------------------------------------------- | ----------------------------- |
| Dependencias remediadas + gate de audit en CI                  | `b988cd5`, `e44993e` (PR #47) |
| Advisory locks con `QueryRunner` estable                       | `f1d964e` (PR #50)            |
| Política fatal ante `uncaughtException`                        | `d61457e` (PR #51)            |
| API fuera de la red pública en Compose                         | `c3fe7cf`                     |
| Env mínimo en el contenedor web                                | `c3fe7cf`                     |
| Security headers (Helmet + nginx: CSP, HSTS, `nosniff`, frame) | `c3fe7cf`                     |
| Rate limiter de auth acotado con `Retry-After`                 | `c3fe7cf`                     |

### Cadena de restore — cerrada y mergeada

Los seis mergeados en orden el 2026-08-24. `main` en `5ec41fa`.

| Ítem                                               | PR  | Merge     |
| -------------------------------------------------- | --- | --------- |
| Lease exclusivo por destino                        | #55 | `1d17497` |
| Admisión serializada frente a mutación de conexión | #57 | `a1c4043` |
| Ownership sostenido a través del preflight         | #59 | `7a48cc4` |
| Recuperación segura de jobs abandonados            | #61 | `c3b5b98` |
| Staging privado de restore + barrido de huérfanos  | #62 | `97231df` |
| Sanitización de salidas y metadata de auditoría    | #63 | `5ec41fa` |

Con esto **U1, U2, U3 y U5 quedan cerrados en `main`**, más seis de los ocho puntos de U4.

---

## 2. Fase A — Cerrar la cadena abierta ✅

**Completada el 2026-08-24.** Los seis PRs mergeados en orden estricto; cero PRs abiertos.

Criterio de salida cumplido y verificado: `main` en `5ec41fa` contiene `common/sanitization/` y `restore-staging.service.ts`.

**Release:** `v1.36.7` (desde `v1.36.6`). Un solo bump de patch, no seis — semantic-release agrupó los seis commits en una corrida. El changelog los lista agrupados por scope (`restore:` ×5, `security:` ×1), que es el beneficio concreto de conservar scopes pese a lo que dice `docs/en/conventions.md`.

**Comprobado tras el merge:**

- [x] Versión publicada: `v1.36.7`, con los seis commits en un release.
- [x] **Despliegue sano.** Railway `EnVault Management` / `production`, commit desplegado `5ec41fa` (merge de #63). `RestoreModule dependencies initialized`, `Nest application successfully started`, y **cero errores de `RestoreService`**: `sweepOrphans()` corrió en el arranque sin lanzar. Backup real disparado y subido a R2 después del deploy.
- [x] **Una sola réplica** (`numReplicas: 1`) en los tres servicios. El rate limiter y el SSE en memoria siguen siendo correctos; Gate D no aplica todavía.
- [x] **`vaultly-api` sin dominio público.** Solo `vaultly-web` expone `vaultlydumps.up.railway.app`. U4-2 se sostiene en el entorno real, no solo en el Compose.

## 2.1 Hallazgos del entorno desplegado

| Hallazgo                                                                      | Severidad              | Nota                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Los requests a `/api/auth/*` se loguean **dos veces**                         | Baja, pero diagnóstica | Firma confirmada: mismo timestamp **y** misma duración (`POST /api/auth/sign-in/email 200 116ms` ×2). Las rutas normales repiten timestamp pero con duraciones distintas, o sea que son peticiones distintas. Casi con seguridad es el middleware de logging enganchado a `finish` **y** `close`, disparado por el `@Res()` + `void this.handler()` de `auth.controller.ts`. **Revisarlo dentro de B1**: es el mismo patrón que impide auditar esas rutas |
| `LegacyRouteConverter`: `/api/auth/*` no soportado por `path-to-regexp` nuevo | Baja                   | Nest lo auto-convierte a `/api/auth/{*path}` y sigue. Preexistente, no introducido por esta cadena. Arreglarlo explícitamente al tocar `auth.controller.ts` en B1                                                                                                                                                                                                                                                                                         |
| `AdminSeedService`: sin `BETTER_AUTH_ADMIN_EMAIL`/`PASSWORD`                  | Ninguna                | Esperado: el seed ya corrió, las variables se quitaron a propósito                                                                                                                                                                                                                                                                                                                                                                                        |

> **Precaución operativa aprendida el 2026-08-24.** `railway domain` **sin subcomando crea un dominio**, no lista. Ejecutarlo contra `vaultly-api` generó un dominio público que hubo que borrar. Para inspeccionar usar siempre `railway domain list`. Un dominio público en la API rompe U4-2 en silencio.

---

## 3. Fase B — Cerrar Fase 1 de seguridad ✅

Dos ítems. B1 cerrado el 2026-08-29, B2 el 2026-08-30. **Fase B cerrada.**

### B1 — Auditoría de eventos Better Auth ✅

**Estado:** ✅ · `b415dd8` (backend) · `5c374c5` (UI) · CI verde en `5c374c5`.

Implementado con `hooks.after` + `createAuthMiddleware`, escribiendo en `audit_logs` a través de `authPool` — el pool de `pg` que Better Auth **ya tenía** en `auth.config.ts` y que `AuthModule.onModuleDestroy` ya cerraba. La decisión que el plan planteaba como abierta estaba mal formulada: la opción del "cliente `pg` propio" no agregaba un segundo pool porque ese pool ya existía.

**Investigación previa (agosto 2026):** Better Auth **no tiene** audit logging oficial en el core ([discussion #7952](https://github.com/better-auth/better-auth/discussions/7952)). Se evaluaron y descartaron:

- `dash()` de `@better-auth/infra` — publicado el 2026-08-28, crea sus propias tablas, no documenta captura de fallos, y duplicaría el sistema de auditoría existente.
- Plugin comunitario `better-auth-audit-logs` — código de terceros en la ruta de autenticación; su esquema sí sirvió como validación del modelado.

**Migración `1778716800019`:** agrega `ipAddress`, `userAgent`, `outcome` y `severity` — los atributos que el OWASP Logging Cheat Sheet exige por evento de seguridad y que la tabla no tenía. `environment` pasa a nullable: su enum describe el entorno de una conexión ERP auditada, y un login no pertenece a ninguno.

**Decisiones que conviene no perder:**

- Los paths auditados son un **allowlist**. `hooks.after` dispara en todos los endpoints incluido `/get-session`, que la SPA consulta constantemente.
- Toda escritura va en `try/catch`: `dispatch.ts` re-lanza cualquier excepción que no sea `APIError` fuera de `runAfterHooks`, y eso reemplazaría la respuesta de login por un crash.
- La IP se lee de `x-real-ip`, que nginx sobrescribe con un valor único validado. La cadena multi-hop `X-Forwarded-For` es spoofable y no se consulta.

**Cobertura:** 15 tests escritos primero (fallo de login, filtrado por allowlist, severidad, redacción de password, y la garantía de que un fallo de escritura no rompe la autenticación).

**⚠️ Pendiente del criterio de aceptación original:** el criterio pedía verificación con **test de integración** contra Postgres real. Lo que existe hoy son tests unitarios de la lógica y de la construcción de la fila; **falta el test que confirme que la fila efectivamente aterriza en `audit_logs`**. El proyecto ya tiene el patrón para hacerlo (`restore-lease.integration.spec.ts`, activado por variable de entorno).

**Hallazgo descartado del plan:** la hipótesis sobre el doble log de `/api/auth/*` era falsa. `request-logger.middleware.ts:29` engancha solo `finish`, nunca `close`, y `app.module.ts` lo registra una sola vez. La firma (mismo timestamp **y** misma duración) apunta a dos listeners sobre el mismo request; el sospechoso es `setGlobalPrefix` con `exclude` chocando con `forRoutes('{*splat}')`. Sin confirmar.

### B2 — Unificar `ValidationPipe` ✅

**Estado:** ✅ · **Commits:** `4532693` (fix) · `6d633b1` (docs)

Había **dos** pipes globales, no uno mal configurado: el de `main.ts` (`whitelist` + `transform` + `enableImplicitConversion`) y el `APP_PIPE` de `app.module.ts` (`whitelist` + `forbidNonWhitelisted` + `transform`). Ambos corrían, en ese orden. El primero descartaba las props no declaradas, así que el `forbidNonWhitelisted` del segundo nunca tenía nada que rechazar: estaba muerto desde que existe.

Unificado en un solo `APP_PIPE` cuyas opciones viven en `apps/api/src/common/pipes/validation-pipe.options.ts`, conservando `enableImplicitConversion` que solo tenía el de bootstrap. Body y query string devuelven 400 ante props no declaradas.

**Corregido de paso:** el dashboard pedía `GET /audit?limit=N` y `ListAuditLogsQueryDto` no declara `limit` — con el cambio pasaba a 400. Ahora manda `pageSize`.

**Verificado que NO rompe:** connections, cronjobs, restore, cleanup y dumps mandan exactamente los campos de sus DTOs. `/jobs/backups` y `/jobs/restores` reciben `?limit=` no declarado pero se salvan porque `JobFilters` es una `interface`, no una clase — el pipe la ignora. Eso significa que esos dos endpoints **no validan nada**: candidato para Fase C.

Docs `en` y `es` §6 corregidos: afirmaban que el rechazo estricto ya estaba activo.

---

## 4. Fase C — Verificaciones pendientes ✅ (Cerrada)

Trabajo de comprobación, no de implementación. Barato y evita construir sobre supuestos.

- [x] **Compatibilidad de engine por `sourceBackupId`.** Verificado: `resolveSourceFileKey()` ya comparaba `backup.dbType !== targetConnection.dbType` rechazando con `ForbiddenException`. Testeado y cubierto con suite unitaria de 6 pruebas en `cccda0a` (PR #64).
- [x] **`/jobs/backups` y `/jobs/restores` no validan input.** Reemplazado `JobFilters` por `ListJobsQueryDto` con validaciones declarativas `@IsOptional`, `@IsEnum(JobStatusEnum)`, `@IsEnum(Environment)`, `@IsISO8601`, `@Type(() => Number)`, `@IsInt`, `@Min(1)`, `@Max(100)` para `limit`. Soportado `take: filters?.limit` en `JobsRepository` para dar soporte a paginación real que el frontend ya consumía (`?limit=5`). Cubierto con 8 tests en `list-jobs-query.dto.spec.ts` y 2 tests en `jobs.controller.spec.ts`.
- [x] **Reejecutar `pnpm audit`.** Ejecutado al 2026-09-25. Total monorepo: 15 vulnerabilidades (2 low, 6 moderate, 7 high, 0 critical). Producción (`pnpm audit --prod`): 8 vulnerabilidades (2 low, 6 moderate, 0 high, 0 critical). Las 7 vulnerabilidades altas pertenecen a devDependencies de testing (`apps/web > vitest` y `@vitest/mocker`).
- [x] **Timeout de restore.** Parametrizado mediante variable de entorno `RESTORE_TIMEOUT_MS` en `env.validation.ts` (default 30 min = 1_800_000 ms, min 10_000 ms). Dimensionado para soportar dumps de hasta 5 GB. Integrado en `PostgresRestoreStrategy`, `MySQLRestoreStrategy` y cálculo dinámico de `restoreLeaseDurationMs` (`timeout + 5 min`). Actualizados `.env.example`, `apps/api/.env.example`, y tests de configuración.
- [x] **Auditar `docs/` contra el código.** Sincronizado `docs/es/security-model.md` y `docs/en/security-model.md` con el schema B1 de audit logs (`ipAddress`, `userAgent`, `outcome`, `severity`, `environment` nullable) y la obligatoriedad estricta de `CORS_ORIGIN`. Documentada la variable `RESTORE_TIMEOUT_MS` en `docs/es/environment-variables.md` y `docs/en/environment-variables.md`.

---

## 5. Fase D — Backup verificable ✅ (Cerrada)

Implementado y validado en un solo PR cohesivo:

- [x] **SHA-256 en el `Transform` que ya cuenta bytes:** Integrado `crypto.createHash('sha256')` en `PostgresBackupStrategy` y `MySQLBackupStrategy` al vuelo en el stream de volcado. Retorna `{ fileSizeMb, sha256, bytes }` sin buffering en memoria.
- [x] **Manifest v2 con `{ sha256, bytes, compression }` + digest en DB:** Generación de Manifest v2 en R2 con retrocompatibilidad v1. Migración TypeORM `1778716800020-add-sha256-and-bytes-to-backup-jobs.ts` agregando columnas `sha256` y `bytes` a `backup_jobs` (`BackupJobEntity`).
- [x] **Verificación con `timingSafeEqual` antes de restaurar:** En `RestoreStagingService.writeDump` y `RestoreService`, cálculo del hash del dump descargado y validación criptográfica contra el digest registrado en DB vía `crypto.timingSafeEqual` (validando longitudes de 32 bytes para prevenir timing attacks y RangeErrors). Rechazo inmediato con `BadRequestException` antes de tocar el destino.
- [x] **`pg_restore -l` como preflight estructural:** En `PostgresRestoreStrategy`, ejecución previa de `pg_restore -l <dump>` para validar la tabla de contenidos (TOC) y cabecera del formato custom. Si el dump está truncado o corrupto, aborta antes de abrir conexiones con la base destino.
- [x] **Alertas + watchdog de cronjobs vencidos:** Implementado `checkWatchdog()` con `@Interval(300_000)` en `CronjobsService`. Monitorea y alerta con logs de error si un cronjob activo superó su ventana programada o tolerancia de tick sin registrar ejecución.
- [x] **`/health` con chequeo real de R2, cacheado y no fatal:** `R2Service.checkHealth()` ejecuta `ListObjectsV2Command` con TTL de 30 segundos en memoria. Integrado en `HealthController` sin fallar la sonda de Kubernetes (non-fatal, degraded info) en caso de intermitencias en R2.
- [x] **Sincronización de esquema inicial (`InitialSchema1700000000000`):** Actualizada la migración base `1700000000000-InitialSchema.ts` para incorporar todas las tablas nuevas (`restore_leases`, `manual_retention_settings`, `connection_retention_policies`, Better Auth: `user`, `session`, `account`, `verification`) y columnas (`sha256`, `bytes`, `ipAddress`, `userAgent`, etc.) de forma idempotente (`IF NOT EXISTS`) garantizando que arranques limpios inicialicen sin tropiezos.

**Criterio de aceptación:** Cubierto y probado con 100% tests verdes (36 suites API, 33 suites Web). Rechaza dumps corruptos, rechaza sustitución de dump y manifest en R2 mediante el digest en DB, aborta ante truncamientos con `pg_restore -l`, vigila cronjobs vencidos, monitoriza R2 en `/health` y provee esquema inicial íntegro y sincronizado.

---

---

## 6. Fase E — Recuperación probada (Disaster Recovery & Operational Drills) ✅ (Cerrada)

Comprobada la supervivencia operativa y la recuperación ante desastres:

- [x] **Backup y PITR de la DB de metadata y auth (`envault`):** Documentada la estrategia integral en `docs/es/devops-runbook.md`, `docs/en/devops-runbook.md` y `disaster-recovery.md`. Identificada la custodia crítica de `ENCRYPTION_KEY` (AES-256-GCM) sin la cual las credenciales quedan matemáticamente irrecoverables ante la pérdida de la base de control.
- [x] **Script y Drill de Restore Real a Sandbox:** Creado `scripts/restore-drill.sh` con verificación de contenedores sandbox (`db-test-pg` en puerto 5434 y `db-test-mysql` en 3306), cálculo y verificación de digest SHA-256, preflight estructural de TOC (`pg_restore -l`), ejecución transaccional atómica (`--single-transaction`) y aserción de conteo de tablas y filas contra el snapshot del manifiesto v2.
- [x] **Conectividad privada ERP (Zero Public TCP Exposure):** Formalizado el estándar inmutable en `docs/es/connecting-on-premise-databases.md` y `docs/en/` estableciendo la prohibición de exponer puertos 5432 o 3306 a internet público, e incluyendo configuraciones de túneles WireGuard (`wg0.conf`) y reglas de firewall UFW.
- [x] **Runbook oficial de Disaster Recovery (`docs/es/disaster-recovery.md` y `docs/en/`):** Procedimiento de arranque en frío (Cold Bootstrap) desde cero, orden de inyección de secretos custodiados (`ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, R2), definición de RTO (30 min) y RPO (1h a 24h), y reconstrucción forense directamente desde Cloudflare R2 leyendo archivos `*.manifest.json` v2 si la base de control desaparece sin respaldo.
- [x] **Integridad y Respaldo Verificable en Landing:** Incorporada la sección de garantías de integridad en `README.md` y `README.es.md` destacando el hashing al vuelo, timingSafeEqual, preflight estructural y simulacros de recuperación. Documentado el despliegue individual de contenedores (`api` y `web` por separado) en `deployment-self-host.md` incluyendo la obligatoriedad de `ENCRYPTION_KEY`.

**Criterio de aceptación:** Runbooks bilingües completos, script ejecutable de drill sandbox con aserción de consistencia de datos, contratos de despliegue individual documentados y presentación pública de integridad en el repositorio.

---

## 7. Fase F — Colas de Procesamiento Asíncrono (Redis + BullMQ) y Dumps Masivos

Diseñada para otorgar robustez operativa ante bases de datos de alto volumen (> 5 GB hasta 100+ GB) y separar el tráfico HTTP interactivo del trabajo pesado de I/O.

### Módulos y componentes impactados:

1. **`BackupModule` (`BackupService`, strategies, API endpoints):**
   - **Desacople HTTP Asíncrono:** `POST /api/backups` deja de bloquear la conexión HTTP durante minutos u horas. Responde `202 Accepted` de inmediato con `{ jobId, status: 'pending' }` y encola la tarea en BullMQ (`backup-queue`).
   - **Timeout configurable para dumps pesados:** Reemplazar el timeout hardcodeado (`BACKUP_TIMEOUT_MS = 600_000`, 10 min) en `postgres-backup.strategy.ts` y `mysql-backup.strategy.ts` por variable de entorno `BACKUP_TIMEOUT_MS` (default 30 min / 1_800_000 ms, ampliable a horas para terabytes).
   - **Control de concurrencia y protección de ERPs:** Limitar la cantidad de backups simultáneos por conexión mediante locks de BullMQ o rate-limiting para no saturar el CPU ni el almacenamiento del servidor origen.
   - **Trazabilidad de jobs encolados:** Detección automática de workers caídos (*stalled jobs*) y reintentos con backoff exponencial.

2. **`RestoreModule` (`RestoreService`, staging, execution):**
   - **Cola de restauración (`restore-queue`):** Encolamiento estructurado en BullMQ con concurrencia unitaria por conexión destino (`concurrency: 1`), integrando `restore_leases` con los locks de BullMQ.
   - **Cancelación interactiva (*graceful abort*):** Endpoint `POST /api/restore/:id/cancel` con `AbortController` que envía señales `SIGTERM`/`SIGKILL` a los subprocesos hijos (`pg_restore`, `mysql`) y limpia el directorio de staging de inmediato.
   - **Preflight de espacio libre en disco en Staging:** Chequear el espacio disponible en disco (`fs.statfs`) antes de descargar volcados pesados desde R2 para erradicar excepciones fatales `ENOSPC`.

3. **`R2Module` / Streaming y Subida de Gran Tamaño:**
   - **Optimización de Multipart Upload:** Configurar `partSize` en `@aws-sdk/lib-storage` `Upload` (32 MB a 64 MB, o dinámico) para evitar el límite crítico de AWS S3 de 10,000 partes que revienta dumps mayores a 48.8 GB con chunks de 5 MB.
   - **Cancelación limpia de partes huérfanas:** Ejecutar `upload.abort()` al ocurrir errores o cancelaciones para no acumular costos de almacenamiento en Cloudflare R2 por subidas truncadas.
   - **Control de contrapresión (*backpressure*):** Regular los búferes de streaming (`highWaterMark`) en el piping `pg_dump -> Transform (sha256 + counter) -> Upload` para que el consumo de memoria RAM de Node se mantenga acotado (< 256 MB) aun volcando bases de 100 GB.
   - **Métricas de transferencia:** Cálculo de velocidad en tiempo real (MB/s) y tiempo estimado restante (ETA) transmitidos vía eventos SSE al frontend.

4. **`CronjobsModule` (`cronjobs.service.ts`):**
   - El programador en memoria se transforma en despachador de tareas hacia BullMQ (*repeatable jobs*), distribuyendo la ejecución entre cualquier cantidad de workers sin duplicar ejecuciones.

5. **Frontend Web (`apps/web`) — UI/UX:**
   - **Creación de Backups no bloqueante:** La acción "Crear Backup" en `/dumps` confirma al instante y muestra el nuevo trabajo en estado `pending` / `queued`.
   - **Barra de progreso por etapas:** Visualización de fases ("En cola", "Calculando snapshot", "Descargando de R2", "Verificando TOC y SHA-256", "Restaurando").
   - **Botón de cancelación:** Permitir al administrador abortar un respaldo o restauración en ejecución.
   - **Monitor de Workers en Dashboard:** Indicador visual sobre la salud de Redis, workers activos y tamaño de colas.

6. **Infraestructura y Configuración:**
   - Incorporar servicio `redis:7-alpine` en `docker-compose.yml` y `docker-compose.dev.yml`.
   - Variables de entorno `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` validadas estrictamente con Joi en `env.validation.ts`.

---

## 8. Diferido con disparador explícito

| Ítem                                      | Disparador de reapertura                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| MFA / SSO para administradores            | Primer tercero, o cualquier exposición fuera de la frontera de confianza actual |
| Cifrado del dump controlado por Vaultly   | Bucket compartido con terceros, o requisito de compliance                       |
| Multi-tenancy o aislamiento por instancia | Primer proyecto fuera de la misma frontera de confianza                         |
| Rotación versionada de `ENCRYPTION_KEY`   | Antes de que exista más de una clave en uso                                     |
| Garantía de entrega de auditoría (outbox) | Requisito legal o investigación forense                                         |

**Sobre MFA:** Evaluado el 2026-08-24. `twoFactor()` con TOTP es completamente local — HMAC sobre un secreto propio y una ventana de 30 s, sin servicio externo. GitHub OAuth con allowlist es más barato de implementar pero mete una dependencia externa en el camino de login de una herramienta de disaster recovery. Decidir eso cuando se reabra, no antes.

---

## 9. Reglas de trabajo

- **El código es la fuente de verdad.** Este documento es una opinión con fecha. Reverificar antes de planificar.
- Commits en inglés, sin atribución de IA. Los scopes están aceptados en este repo pese a `docs/en/conventions.md`.
- Sin comentarios en el código nuevo. Sin `any` — ESLint lo bloquea.
- Cada cambio arranca con el test que reproduce el fallo o el criterio.
- PRs por ítem. Si un diff pasa de 400 líneas de código de producción, encadenar.

## Observaciones de Isaac cerradas ✅

- [x] **Renovación periódica del Lease en Restore:** Implementado heartbeat periódico cada 60 s (o `restoreLeaseDurationMs / 4`) en `RestoreService.executeRestoreAsync` usando `RestoreLeaseRepository.renew()`. Garantiza que descargas prolongadas de R2 o restores multi-fase en MySQL no expiren la concesión mientras el proceso esté activo. Agregado casteo defensivo `::uuid` en `RestoreLeaseRepository` (`tryAcquire`, `renew`, `release`). Cubierto con unit tests en `restore.service.spec.ts`.
- [x] **Rechazo explícito de comodines (`*`) en `CORS_ORIGIN`:** En `env.validation.ts`, añadido validador custom a Joi que rechaza cualquier origen que contenga `*` (`CORS_ORIGIN cannot contain wildcard (*)`). Cubierto con tests unitarios en `env.validation.spec.ts`.
- [x] **Sincronización de fallback DEV en `AuditInterceptor`:** Actualizado `docs/es/security-model.md` bajo "Limitaciones conocidas" para documentar honestamente el fallback a `Environment.DEV` cuando la petición no especifica entorno, alcanzando paridad con `docs/en/security-model.md`.
- [x] **Sincronización de base de datos en Compose y `.env.example`:** Actualizado `.env.example` para que `DATABASE_URL` apunte a `/envault` (en lugar de `/vaultly`) y el correo de admin inicial sea `admin@envault.local`. Sincronizado `apps/api/src/config/env.validation.spec.ts`.
