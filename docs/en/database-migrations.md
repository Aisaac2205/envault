# Database Migrations — Operational Guide

> 🇪🇸 Versión en español: [../es/database-migrations.md](../es/database-migrations.md)

> **Audience**: any developer who needs to bring the API up against a new database, or add/run migrations.

---

## 1. The problem this guide solves

The project uses **TypeORM with `synchronize: false` + `migrationsRun: true`** (see [`apps/api/src/config/database.config.ts`](../../apps/api/src/config/database.config.ts)). That means:

- The API does NOT auto-create tables from `@Entity` declarations at startup.
- The API DOES run every migration in `src/database/migrations/` in order at startup.

**State at the time of writing**: every existing migration is an `ALTER TABLE` / `addColumn` that **assumes pre-existing tables**. There is no migration that runs `CREATE TABLE` for the initial schema.

Consequence: if you bring the API up against an empty Postgres database (a new environment, a fresh container, a CI test), the first migration tries `ALTER TABLE backup_jobs ...` and Postgres responds:

```
ERROR: relation "backup_jobs" does not exist
```

The app crashes and ends up in a restart loop.

---

## 2. Why we do NOT solve this with a manual DDL

> This section exists because "I'll keep an `init.sql` and run it by hand" is the first temptation. It's a bad idea. Here's why.

### 2.1 Drift between entities and SQL

The schema's source of truth is the `*.entity.ts` files. If we introduce a parallel `init.sql`:

- Today: entities and SQL match.
- Month 1: someone adds `@Column() phone: string` to `ConnectionEntity`. Forgets to update `init.sql`.
- Month 2: a new developer clones the repo, runs `init.sql`, brings the API up → everything works… until an `INSERT` fails in production because the `phone` column does not exist.
- Debugging: 3 hours minimum. The error is far from the cause.

With versioned migrations, **adding a column requires generating a migration**, so divergence becomes structurally impossible.

### 2.2 Out-of-sync `migrations` table

TypeORM keeps an internal table named `migrations` with the record of which migrations have already been applied. If we create the tables with a manual DDL:

1. Tables exist ✅
2. The `migrations` table is empty ❌
3. On startup, `migrationsRun: true` re-runs ALL migrations
4. Current migrations are well-defended with `hasColumn()`, so the `addColumn` is skipped — but the **backfill `UPDATE`s** (see [`1715200000000-add-dbtype-to-backup-jobs.ts:27-33`](../../apps/api/src/database/migrations/1715200000000-add-dbtype-to-backup-jobs.ts)) still execute. On an empty DB it's a no-op; on a DB with data it might overwrite it.

### 2.3 Not reproducible

The day we add staging, QA, a new client, CI, ephemeral runners… every environment will need the DDL applied by a human. With migrations: `docker compose up` and the API self-provisions against an empty DB. Always. With no manual step.

### 2.4 Human error margin when writing the DDL

Reproducing by hand every `CREATE TABLE`, enum type (TypeORM creates one per column), FK, unique index, default, cast and constraint from 5 entities is a **guaranteed bug**. The TypeORM CLI generates it automatically from the entities, with no room for error.

---

## 3. The solution: generate an `InitialSchema` migration

### 3.1 General idea

We generate **a single migration** that creates every table from the current entity state. We name it `InitialSchema` and give it a timestamp earlier than every existing migration (the oldest today is `1715200000000`). So the chronological order at startup becomes:

```
1700000000000-InitialSchema.ts                              ← CREATE TABLE everything
1715200000000-add-dbtype-to-backup-jobs.ts                  ← existing ALTER
1746662400000-RenameAuditUserEmailToUsername.ts             ← existing ALTER
1778716800001-add-slug-to-connections.ts                    ← existing ALTER
... (rest in order)
```

Existing migrations are already defended with `hasColumn()` / `await queryRunner.hasColumn(...)`, so if `InitialSchema` creates the tables with the modern column set, the later migrations skip cleanly. **The team designed this defensively on purpose.**

### 3.2 Prerequisites (one-time)

We need `ts-node` installed as a devDep so the TypeORM CLI can read `.entity.ts` files without compiling:

```bash
pnpm --filter @vaultly-control/api add -D ts-node
```

> The `migration:*` scripts in [`apps/api/package.json`](../../apps/api/package.json) and the [`apps/api/src/data-source.ts`](../../apps/api/src/data-source.ts) file are already in place.

### 3.3 Step by step

**Step 1 — Bring up an empty Postgres**

The TypeORM CLI compares entities against the current DB state to compute the diff. We need an **empty** DB so the diff is "create everything from scratch".

Option A (fast, recommended): a separate temporary container:

```bash
docker run --rm --name tmp-pg -e POSTGRES_PASSWORD=tmp -e POSTGRES_DB=envault_tmp -p 5433:5432 -d postgres:16-alpine
```

> We use host port `5433` to avoid colliding with the main compose `db`.

Option B (with compose): `docker compose up db` with a clean volume (`docker volume rm db-control_db_data` first).

**Step 2 — Generate the migration**

```bash
# Point the env at the empty temporary DB
$env:DATABASE_URL = "postgresql://postgres:tmp@localhost:5433/envault_tmp"

# Generate
pnpm --filter @vaultly-control/api migration:generate src/database/migrations/InitialSchema
```

This creates a file like `src/database/migrations/<timestamp>-InitialSchema.ts` with every `CREATE TABLE`, FK, enum, index and default derived from the 5 entities.

**Step 3 — Rename the timestamp**

The generated file will have a timestamp from the current moment (greater than every existing migration). Rename it so it runs **first**:

```
<current-timestamp>-InitialSchema.ts   →   1700000000000-InitialSchema.ts
```

Adjust the class name inside the file too if TypeORM generated it with the timestamp:

```ts
export class InitialSchema1700000000000 implements MigrationInterface { ... }
```

**Step 4 — Verify the file**

Open the generated file and check that:

- There is a `CREATE TABLE` for each of the 5 entities (`connections`, `backup_jobs`, `restore_jobs`, `audit_logs`, `cronjobs` — confirm the actual names in each `@Entity('...')`).
- Enum types have a matching `CREATE TYPE ... AS ENUM (...)`.
- FKs between tables are present where appropriate.
- Unique indexes (e.g. `IDX_connections_slug_unique`) are present.

**Step 5 — Run the full flow against a clean DB**

```bash
# Take down the main compose DB (with clean volume)
docker compose down -v

# Bring it back fresh
docker compose up db -d

# Wait a few seconds, then start the API
docker compose up api
```

If the API logs the migrations applied in order and stays listening on `:3000` with no errors, **it worked**.

**Step 6 — Cleanup**

```bash
docker stop tmp-pg
```

Commit: the `data-source.ts`, the updated `package.json`, and the `1700000000000-InitialSchema.ts` file.

---

## 4. Flow for future migrations

Once the initial migration exists, **any future schema change follows this flow**:

1. You modify an entity (add `@Column`, change a type, add an index, etc.).
2. Bring up a DB with the current schema (the `docker compose up db` one is fine).
3. Generate the new migration:
   ```bash
   pnpm --filter @vaultly-control/api migration:generate src/database/migrations/<DescriptiveName>
   ```
4. Review the generated SQL.
5. Commit entity + migration **together, in the same PR**.

> ⚠️ **Never modify a migration that has been committed and applied in any environment.** If you need to fix something, generate a new migration that fixes the problem. A migration is immutable after the first `migration:run` in any environment.

---

## 5. Available commands (already configured in `package.json`)

| Command | Use |
|---|---|
| `pnpm --filter @vaultly-control/api migration:generate <path>` | Generates a migration with the diff between entities and the current DB |
| `pnpm --filter @vaultly-control/api migration:create <path>` | Creates an empty migration file (for manual migrations like backfills) |
| `pnpm --filter @vaultly-control/api migration:run` | Applies pending migrations (the app does this automatically with `migrationsRun: true`, but useful for debugging) |
| `pnpm --filter @vaultly-control/api migration:revert` | Reverts the last applied migration |
| `pnpm --filter @vaultly-control/api migration:show` | Lists which migrations are applied and which are pending |

All require `DATABASE_URL` set in the environment.

---

## 6. FAQ

**Why not `synchronize: true` in dev and migrations in prod?**

Because they drift apart without you noticing. In dev, `synchronize` does any change magically; in prod, migrations are the only way. Result: what "works" in dev requires a migration in prod that nobody wrote. Migrations everywhere = single source of truth.

**What if I make a mistake while generating the migration?**

Delete the generated `.ts` file, adjust whatever needs adjusting in the entities, and generate again. As long as you haven't committed/applied it in any environment, nothing happens.

**Why is there a `data-source.ts` in addition to `database.config.ts`?**

Because the TypeORM CLI runs outside NestJS and needs a plain `DataSource` export. It's explained in the comment at the top of [`data-source.ts`](../../apps/api/src/data-source.ts).

**Can the initial migration break existing environments (current prod)?**

No. If the DB already has the tables, TypeORM just records the migration as "already applied" in the `migrations` table the first time you run `migration:run` with `--fake` (or you can `INSERT` manually into `migrations`). For environments that already have the schema, the flow is:

```sql
INSERT INTO migrations (timestamp, name) VALUES (1700000000000, 'InitialSchema1700000000000');
```

This marks the migration as applied without executing it. Only applies to LEGACY environments that already have tables.

**I pushed an image with a buggy migration. Do I overwrite the same tag or bump the version?**

**Bump the version.** Docker image tags must be treated as immutable: once `envault-api:0.1.0` is published, that content must stay fixed forever. If anyone (a teammate, CI, a customer) already ran `docker pull` of that tag, their local cache has the broken version. Overwriting the tag in the registry does NOT update those caches — they keep running the old one until they pull again. By bumping to `0.1.1` (or `0.1.0-fix1` if you want to signal it's a hotfix), every environment that pulls it gets the new version, unambiguously. The general rule: **one version = one immutable content, forever**.

**My web container is in a restart loop with `exit 127` saying `99-config.sh: not found` even though the file exists. What's going on?**

Your `.sh` file has Windows line endings (CRLF `\r\n`) instead of Unix (LF `\n`). Linux reads the first line as `#!/bin/sh\r` and tries to find the interpreter `/bin/sh\r` (with the trailing `\r`), can't find it, and returns "command not found" → exit 127. The message is misleading: it's not the SCRIPT that's missing, it's the INTERPRETER from the shebang. Check with `bash -c "head -1 file.sh | od -c"` — if you see `\r \n` at the end, that's the bug. Quick fix: `sed -i 's/\r$//' file.sh` and rebuild. Preventive fix: the repo root `.gitattributes` already forces LF for `*.sh`, `*.envsh`, `Dockerfile`, `nginx.conf`, `*.conf.template` and `docker-compose*.yml` at clone time, so any dev on Windows is covered.
