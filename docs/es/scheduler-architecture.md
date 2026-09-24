# Scheduler Architecture

> 🇬🇧 English version: [../en/scheduler-architecture.md](../en/scheduler-architecture.md)

## Decisión actual: `@nestjs/schedule` + advisory locks de Postgres

### ¿Qué hace el scheduler?

El módulo de cronjobs permite definir backups automáticos de bases de datos de producción en una expresión cron estándar (`0 2 * * *`, `*/30 * * * *`, etc.). Cada disparo invoca `BackupService.createBackup()` con un usuario de sistema y sube el dump a Cloudflare R2.

### Flujo de vida de un cronjob

```
POST /cronjobs          → CronjobsService.create()
                        → guarda en DB
                        → registra en SchedulerRegistry (si isActive: true)

PUT /backups/settings/:connectionId → CronjobsService.upsertSchedule()
                                    → busca cronjob existente para esa conexión
                                    → si no existe → crea uno nuevo
                                    → si existe → actualiza cronExpression
                                    → recarga en SchedulerRegistry

POST /cronjobs/:id/toggle → toggle isActive en DB
                          → registra o elimina del SchedulerRegistry

PATCH /cronjobs/:id     → actualiza DB
                        → destruye el job anterior
                        → recrea con la nueva configuración

DELETE /cronjobs/:id    → elimina del SchedulerRegistry
                        → elimina de DB

App bootstrap           → carga todos los cronjobs activos de DB
                        → registra cada uno en SchedulerRegistry
```

> `PUT /backups/settings/:connectionId` es el punto de entrada desde la UI de Dumps. Permite configurar el schedule directamente desde la vista de backups sin navegar a la sección de Cronjobs. Internamente llama a `CronjobsService.upsertSchedule()` — no crea duplicados si ya existe un cronjob para esa conexión.

### Estado de ejecución

Cada disparo actualiza la entidad `CronjobEntity`:

| Campo | Valor |
|-------|-------|
| `lastRunAt` | Timestamp de inicio |
| `lastStatus` | `running` → `completed` / `failed` |
| `nextRunAt` | Próxima ejecución (calculada desde `CronJob.nextDate()`) |

### Dependencias

| Paquete | Versión | Rol |
|---------|---------|-----|
| `@nestjs/schedule` | ^6.x | Módulo NestJS, expone `SchedulerRegistry` |
| `cron` | ^4.x | Motor de scheduling, provee `CronJob` y `nextDate()` (Luxon DateTime) |

---

## Seguridad multi-réplica: advisory locks de Postgres

`SchedulerRegistry` de `@nestjs/schedule` sigue haciendo tick de forma independiente **en cada proceso** — eso no cambió. Lo que cambió es que cada tick ya no asume ser el único corriendo: antes de hacer cualquier trabajo, toma un advisory lock de sesión de Postgres específico para ese job, y se salta la ejecución por completo si otra réplica ya lo tiene.

- `CronjobsService.executeCronjob()` hashea el id del cronjob a un lock id (`stableHash()`) y ejecuta `SELECT pg_try_advisory_lock($1)` en un `QueryRunner` dedicado antes de tocar el job. Si no consigue el lock, registra `skipped — lock held by another replica` y retorna de inmediato — sin backup duplicado.
- El mismo patrón protege `MaintenanceService.sweepManualRetention()` (con un lock id fijo, porque solo un sweep debe correr en todo el clúster) y la titularidad de ejecución de restauraciones en `RestoreExecutionOwnershipService` (con lock por conexión destino, vía `pg_try_advisory_lock(hashtextextended($1, 0))`).
- El lock siempre se libera en un bloque `finally` (`pg_advisory_unlock`), incluso si el trabajo protegido lanza una excepción.
- El ciclo de vida está cubierto por una suite de tests compartida, `apps/api/src/modules/scheduler-locks/scheduler-locks.spec.ts`, corrida contra el cronjob y el sweep de mantenimiento para mantener consistente el contrato adquirir → trabajar → liberar → manejo de errores en todos los puntos donde se usa.

No existe una clase `SchedulerLocksService` separada — es un patrón SQL repetido y deliberadamente testeado (`pg_try_advisory_lock` / `pg_advisory_unlock` crudo vía `DataSource`/`QueryRunner` de TypeORM), no una abstracción compartida. Si un tercer punto necesita la misma garantía, copiá el patrón y sumalo al spec compartido.

**Efecto neto**: hoy podés correr más de una réplica de la API sin backups programados duplicados, sin sweeps de retención duplicados, y sin que dos réplicas restauren sobre la misma conexión al mismo tiempo.

---

## Todavía en el roadmap: BullMQ + Redis

Los advisory locks resuelven la *ejecución duplicada*, no la *semántica de cola*. No dan reintentos, delays, backoff, ni una UI de visibilidad (`bull-board`). Si eso se vuelve necesario, el camino de migración sigue siendo:

```
ACTUAL
CronjobsService → SchedulerRegistry → CronJob → (advisory lock) → BackupService.createBackup()

FUTURO
CronjobsService → BullMQ Queue → Worker → (advisory lock, si sigue haciendo falta) → BackupService.createBackup()
```

1. Agregar Redis al stack de infraestructura (Docker Compose + K8s).
2. Instalar `@nestjs/bullmq` y `bullmq`.
3. Reemplazar `SchedulerRegistry` por `Queue` en `CronjobsService`.
4. Crear un `CronjobProcessor` (worker) que procese los jobs de la cola.
5. Eliminar `@nestjs/schedule` y `cron` si ya no se usan en otros módulos.
6. Mantener la tabla `cronjobs` intacta — `cronExpression` se convierte en el patrón del job repetible de BullMQ.

El contrato público (`CronjobsController`, `CronjobsRepository`, `CronjobEntity`) no cambiaría; solo la capa de despacho interna de `CronjobsService`.

---

## Decisiones de diseño

> **Fecha**: 2026-05-06
> **Contexto**: El proyecto no estaba deployado aún. No existía infraestructura multi-réplica ni Redis.
> **Decisión**: Usar `@nestjs/schedule` para evitar agregar Redis como dependencia prematura.
> **Trigger para revisar**: Cuando se detecten backups duplicados en producción o se planifique escalar la API a más de un pod.

> **Fecha**: 2026-09-24
> **Contexto**: El despliegue multi-réplica pasó de hipotético a planificado; la ejecución duplicada necesitaba una solución antes de que Redis se justificara.
> **Decisión**: Agregar advisory locks de Postgres (`pg_try_advisory_lock` / `pg_advisory_unlock`) alrededor de la ejecución de cronjobs, el sweep de retención manual y la titularidad de ejecución de restauraciones — sin infraestructura nueva, reusa la base de datos del control plane que ya existe.
> **Trigger para revisar**: Cuando se necesite semántica de cola (reintentos, delays, visibilidad de workers), no solo seguridad ante ejecución duplicada — eso sigue siendo la migración a BullMQ + Redis de arriba.
