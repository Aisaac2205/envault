# Scheduler Architecture

> 🇪🇸 Versión en español: [../es/scheduler-architecture.md](../es/scheduler-architecture.md)

## Current decision: `@nestjs/schedule` + Postgres advisory locks

### What does the scheduler do?

The cronjobs module lets you define automatic backups of production databases on a standard cron expression (`0 2 * * *`, `*/30 * * * *`, etc.). Each trigger invokes `BackupService.createBackup()` with a system user and uploads the dump to Cloudflare R2.

### Cronjob lifecycle

```
POST /cronjobs          → CronjobsService.create()
                        → persists to DB
                        → registers in SchedulerRegistry (if isActive: true)

PUT /backups/settings/:connectionId → CronjobsService.upsertSchedule()
                                    → looks up existing cronjob for that connection
                                    → if none → creates a new one
                                    → if one → updates cronExpression
                                    → reloads in SchedulerRegistry

POST /cronjobs/:id/toggle → toggles isActive in DB
                          → registers or removes from SchedulerRegistry

PATCH /cronjobs/:id     → updates DB
                        → destroys the prior job
                        → recreates with the new configuration

DELETE /cronjobs/:id    → removes from SchedulerRegistry
                        → deletes from DB

App bootstrap           → loads every active cronjob from DB
                        → registers each in SchedulerRegistry
```

> `PUT /backups/settings/:connectionId` is the entry point from the Dumps UI. It lets you configure the schedule directly from the backups view without navigating to the Cronjobs section. Internally it calls `CronjobsService.upsertSchedule()` — it does not create duplicates if a cronjob already exists for that connection.

### Execution state

Every trigger updates the `CronjobEntity`:

| Field | Value |
|-------|-------|
| `lastRunAt` | Start timestamp |
| `lastStatus` | `running` → `completed` / `failed` |
| `nextRunAt` | Next execution (computed from `CronJob.nextDate()`) |

### Dependencies

| Package | Version | Role |
|---------|---------|------|
| `@nestjs/schedule` | ^6.x | NestJS module, exposes `SchedulerRegistry` |
| `cron` | ^4.x | Scheduling engine, provides `CronJob` and `nextDate()` (Luxon DateTime) |

---

## Multi-replica safety: Postgres advisory locks

`@nestjs/schedule`'s `SchedulerRegistry` still ticks independently **in every process** — that part hasn't changed. What changed is that each tick no longer assumes it's the only one running: before doing any work, it takes a Postgres session-level advisory lock scoped to that specific job, and skips the run entirely if another replica already holds it.

- `CronjobsService.executeCronjob()` hashes the cronjob id into a lock id (`stableHash()`) and calls `SELECT pg_try_advisory_lock($1)` on a dedicated `QueryRunner` before touching the job. If the lock isn't acquired, it logs `skipped — lock held by another replica` and returns immediately — no duplicate backup.
- The same pattern guards `MaintenanceService.sweepManualRetention()` (a fixed lock id, since only one sweep should run cluster-wide) and restore execution ownership in `RestoreExecutionOwnershipService` (locked per target connection, via `pg_try_advisory_lock(hashtextextended($1, 0))`).
- The lock is always released in a `finally` block (`pg_advisory_unlock`), even when the guarded work throws.
- Lifecycle is covered by a shared test suite, `apps/api/src/modules/scheduler-locks/scheduler-locks.spec.ts`, run against both the cronjob and maintenance call sites to keep the acquire → work → release → error-handling contract consistent wherever the pattern is used.

There is no separate `SchedulerLocksService` class — this is a repeated, deliberately-tested SQL pattern (raw `pg_try_advisory_lock` / `pg_advisory_unlock` via TypeORM's `DataSource`/`QueryRunner`), not a shared abstraction. If a third call site needs the same guarantee, copy the pattern and add it to the shared spec.

**Net effect**: you can run more than one API replica today without duplicate scheduled backups, duplicate retention sweeps, or two replicas restoring into the same connection at once.

---

## Still on the roadmap: BullMQ + Redis

Advisory locks solve *duplicate execution*, not *queue semantics*. They don't give you retries, delayed jobs, backoff, or a visibility UI (`bull-board`). If those become necessary, the migration path is still:

```
CURRENT
CronjobsService → SchedulerRegistry → CronJob → (advisory lock) → BackupService.createBackup()

FUTURE
CronjobsService → BullMQ Queue → Worker → (advisory lock, if still needed) → BackupService.createBackup()
```

1. Add Redis to the infrastructure stack (Docker Compose + K8s).
2. Install `@nestjs/bullmq` and `bullmq`.
3. Replace `SchedulerRegistry` with `Queue` in `CronjobsService`.
4. Create a `CronjobProcessor` (worker) that processes the queued jobs.
5. Drop `@nestjs/schedule` and `cron` if no other module uses them.
6. Keep the `cronjobs` table intact — `cronExpression` becomes the BullMQ repeatable job pattern.

The public contract (`CronjobsController`, `CronjobsRepository`, `CronjobEntity`) would not change; only `CronjobsService`'s internal dispatch layer would.

---

## Design decisions

> **Date**: 2026-05-06
> **Context**: The project was not deployed yet. There was no multi-replica infrastructure nor Redis.
> **Decision**: Use `@nestjs/schedule` to avoid adding Redis as a premature dependency.
> **Trigger to revisit**: When duplicate backups appear in production, or when scaling the API to more than one pod becomes planned.

> **Date**: 2026-09-24
> **Context**: Multi-replica deployment moved from hypothetical to planned; duplicate execution needed a fix before Redis was justified.
> **Decision**: Add Postgres advisory locks (`pg_try_advisory_lock` / `pg_advisory_unlock`) around scheduled cronjob execution, the manual retention sweep, and restore execution ownership — no new infrastructure, reuses the existing control-plane database.
> **Trigger to revisit**: When queue semantics (retries, delays, worker visibility) are needed, not just duplicate-execution safety — that's still the BullMQ + Redis migration above.
