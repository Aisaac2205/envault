# Troubleshooting

> 🇪🇸 Versión en español: [../es/troubleshooting.md](../es/troubleshooting.md)

Common failure modes during install, configuration, and operation, with concrete diagnosis and fixes. Skim by symptom; full fix is in the linked section.

---

## Quick index by symptom

| Symptom | Section |
|---------|---------|
| Local dev: API crashes on startup with `relation "X" does not exist` | [§1.1](#11-api-crashes-with-relation-does-not-exist) |
| Local dev: API crashes with `ECONNREFUSED 127.0.0.1:5432` | [§1.2](#12-econnrefused-on-postgres) |
| Local dev: `pnpm install` fails on Windows with EPERM | [§1.3](#13-pnpm-install-fails-on-windows) |
| Local dev: login page shows error or session not persisting | [§1.4](#14-login-errors-or-session-not-persisting) |
| Connection test fails: `password authentication failed` | [§2.1](#21-password-authentication-failed) |
| Connection test fails: `SSL connection is required` | [§2.2](#22-ssl-required-error) |
| Connection test fails: timeout after 5 seconds | [§2.3](#23-connection-timeout) |
| Connection test fails: `no pg_hba.conf entry` | [§2.4](#24-pg_hbaconf-no-entry) |
| Backup hangs / never completes | [§3.1](#31-backup-hangs) |
| Backup fails: `pg_dump: server version mismatch` | [§3.2](#32-pg_dump-version-mismatch) |
| Restore fails: `403 Forbidden, restore to PROD blocked` | [§3.3](#33-restore-blocked-by-prod-rule) |
| Cronjob does not fire | [§3.4](#34-cronjob-does-not-fire) |
| Cronjob fires twice | [§3.5](#35-cronjob-fires-twice) |
| Railway: nginx returns 404 on `/` | [§4.1](#41-railway-nginx-404) |
| Railway: web loads with empty config strings | [§4.2](#42-vite-vars-not-baked) |
| Railway: `EPROTO SSL alert 40` from API | [§4.3](#43-r2-ssl-alert-40) |
| Docker: web container restart loop, `99-config.sh: not found` | [§4.4](#44-script-shebang-crlf) |
| Audit logs all show `environment: dev` even for PROD operations | [§5.1](#51-audit-environment-defaults-to-dev) |

---

## 1. Local development

### 1.1 API crashes with "relation X does not exist"

**Symptom**: API logs show `error: relation "backup_jobs" does not exist` at startup, then restart loop.

**Cause**: TypeORM uses `synchronize: false` and `migrationsRun: true`. The migrations directory has no `CREATE TABLE` for the initial schema — only `ALTER TABLE` migrations that assume tables exist.

**Fix**: Generate an `InitialSchema` migration. Full procedure in [database-migrations.md §3](database-migrations.md#3-the-solution-generate-an-initialschema-migration).

Short version:
```bash
docker run --rm --name tmp-pg -e POSTGRES_PASSWORD=tmp -e POSTGRES_DB=envault_tmp -p 5433:5432 -d postgres:16-alpine
DATABASE_URL=postgresql://postgres:tmp@localhost:5433/envault_tmp \
  pnpm --filter @vaultly-control/api migration:generate src/database/migrations/InitialSchema
# Rename to 1700000000000-InitialSchema.ts so it runs first
```

### 1.2 ECONNREFUSED on Postgres

**Symptom**: `Error: connect ECONNREFUSED 127.0.0.1:5432` when running `pnpm dev`.

**Cause**: The local Postgres container is not running.

**Fix**:
```bash
docker ps                         # confirm 'db' container is up
pnpm docker:db                    # if not, start it
docker logs db-control_db_1       # check logs if container is unhealthy
```

If the container is up but the API still can't connect, check that `DATABASE_URL` in `apps/api/.env` points to `localhost:5432`, not `db:5432` (the latter only works inside Docker Compose).

### 1.3 pnpm install fails on Windows

**Symptom**: `EPERM: operation not permitted` or symlink errors during `pnpm install`.

**Cause**: Windows requires Developer Mode or admin privileges to create symlinks, which pnpm uses extensively.

**Fix**:
1. Enable Developer Mode: Settings → Privacy & Security → For developers → Developer Mode → On.
2. Restart your terminal.
3. Delete `node_modules` and `pnpm-lock.yaml` lockfile if corrupted, then `pnpm install` again.

Alternative: run from WSL2 where symlinks work natively.

### 1.4 Login errors or session not persisting

**Symptom**: Login form returns an error, or the user is logged in but the session is lost on page refresh.

**Common causes & fixes**:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `BETTER_AUTH_SECRET is not set` in API logs | Missing env var | Set `BETTER_AUTH_SECRET` in `apps/api/.env` |
| Login succeeds but session is lost immediately | Cookie domain mismatch | Confirm `BETTER_AUTH_URL` matches the exact origin the browser uses (including `http://localhost:3000` in dev) |
| `401 Unauthorized` on all API requests after login | CORS misconfiguration — `credentials: 'include'` not set or `CORS_ORIGIN` wrong | In dev ensure `CORS_ORIGIN=http://localhost:5173`; in prod use the exact frontend domain |
| Empty strings in `window.APP_CONFIG` | `.env` is missing or `VITE_*` vars not exposed | Confirm `apps/web/.env` exists with `VITE_API_URL` set |

---

## 2. Database connections

### 2.1 Password authentication failed

**Symptom**: Connection test returns `{ "success": false, "error": "password authentication failed for user 'X'" }`.

**Diagnosis from the EnVault Management host**:
```bash
PGPASSWORD='<password>' psql -h <host> -p <port> -U <user> -d <database> -c '\conninfo'
```

If this works from CLI but fails in EnVault Management, the discrepancy is in the credentials you typed. If it fails from CLI too, the password is wrong or the user doesn't exist on the DB.

### 2.2 SSL required error

**Symptom**: Connection test returns `error: SSL/TLS required` or `the server does not support SSL, but SSL was required`.

**Cause**: The managed DB enforces SSL (Neon, Supabase, Azure Flexible Server, RDS with `force_ssl=1`). EnVault Management does not expose the `sslmode` parameter in the UI today.

**Workarounds**:
1. **Disable SSL enforcement on the provider** (only on RDS with parameter group changes, Azure Single Server, Cloud SQL with non-SSL allowed). **Not recommended for production**.
2. **Self-host an SSL-terminating proxy** in front of the DB (HAProxy, pgBouncer with TLS).
3. **Wait for the native SSL feature** (tracked in [architecture-roadmap.md](architecture-roadmap.md)).

Details per provider: [connecting-cloud-databases.md §3](connecting-cloud-databases.md#3-provider-specific-recipes).

### 2.3 Connection timeout

**Symptom**: Connection test hangs for 5 seconds, then returns `latencyMs: 5000+, error: connection timeout`.

**Diagnosis from the EnVault Management host**:
```bash
nc -zv <host> <port>             # confirm TCP reachability
ping <host>                       # confirm hostname resolves
traceroute <host>                 # confirm path is not blocked
```

**Common causes**:
- Provider's IP allowlist does not include the EnVault Management host's egress IP.
- Security group / firewall rule blocking inbound from EnVault Management's IP.
- DB is behind a VPN/private network and EnVault Management is not (see [connecting-on-premise-databases.md](connecting-on-premise-databases.md)).
- Wrong port (e.g., using `5433` where the DB listens on `5432`).

### 2.4 pg_hba.conf no entry

**Symptom**: `no pg_hba.conf entry for host "X.X.X.X", user "Y", database "Z"`.

**Cause**: PostgreSQL's host-based auth file rejects the source IP. Common on self-hosted Postgres without `host` lines for the EnVault Management subnet.

**Fix on the DB side** (`pg_hba.conf`):
```
host    <database>    <user>    <envault-cidr>    md5
```

Then `SELECT pg_reload_conf();` or restart Postgres.

---

## 3. Backups, restores, cronjobs

### 3.1 Backup hangs

**Symptom**: Backup job stays in `running` state indefinitely. No error.

**Possible causes**:
- The DB has very large tables and `pg_dump` is genuinely working — check API logs for progress, monitor R2 bucket size.
- Network drop between EnVault Management and the source DB silently dropped the connection (no retry today).
- R2 upload stalled (rare — `@aws-sdk/lib-storage` handles multipart well).

**Diagnosis**:
```bash
# In the EnVault Management API container/host:
ps aux | grep pg_dump            # is the dump process still alive?
docker stats envault-api          # CPU/memory/network usage
# Check R2 bucket: are new parts being uploaded?
```

**Fix today**: kill and retry. The backup job status will need to be manually updated in the DB (`UPDATE backup_jobs SET status='failed' WHERE id='...'`) — there is no UI button to cancel.

### 3.2 pg_dump version mismatch

**Symptom**: Backup fails with `pg_dump: error: server version: 16.x; pg_dump version: 15.x; aborting because of server version mismatch`.

**Cause**: The EnVault Management API container ships a specific `pg_dump` version. `pg_dump` must be **≥** the source server version. If your managed DB upgraded to Postgres 17 and EnVault Management's container has `pg_dump` 16, dumps break.

**Fix**: Update [`apps/api/Dockerfile`](../../apps/api/Dockerfile) to install a newer `postgresql-client` version. Look for the `POSTGRES_CLIENT_VERSION` build arg or the `apt-get install postgresql-client-X` line, bump it, rebuild, redeploy.

### 3.3 Restore blocked by PROD rule

**Symptom**: Restore returns `403 Forbidden: cannot restore into PROD environment`.

**Cause**: By design — restoring over a PROD connection is blocked at the service layer ([security-model.md §1.3](security-model.md#13-restores-can-never-touch-prod)). This is a feature, not a bug.

**If you legitimately need to restore production data**: restore to a DEV/SQA connection first, validate, then have a DBA do the actual PROD restore manually outside EnVault Management with proper change management.

### 3.4 Cronjob does not fire

**Symptom**: Cronjob is configured and `isActive: true`, but `lastRunAt` never updates.

**Diagnosis**:
```sql
-- Connect to the control DB
SELECT id, name, cron_expression, is_active, last_run_at, next_run_at, last_status
FROM cronjobs WHERE name = '<your job name>';
```

**Common causes**:
- `nextRunAt` is in the past but `isActive: false` — toggle it on.
- API process restarted and the cronjob was not re-registered (shouldn't happen — `OnApplicationBootstrap` reloads them — but check logs).
- Cron expression is invalid; check it with `crontab.guru`.
- Server timezone vs cron expression mismatch (cron runs in container TZ — `docker exec envault-api date`).

### 3.5 Cronjob fires twice

**Symptom**: Two backup jobs created within seconds of each other for the same cronjob.

**Cause**: Almost certainly **multiple API replicas running**. The current scheduler is single-replica by design ([scheduler-architecture.md](scheduler-architecture.md)). Each replica registers and fires every cronjob.

**Fix**: scale the API service down to 1 replica until the BullMQ + Redis migration is implemented (also in [architecture-roadmap.md](architecture-roadmap.md)).

---

## 4. Deployment (Railway)

### 4.1 Railway nginx 404

**Symptom**: Web service is healthy on Railway but returns 404 at `/`.

**Cause**: Target port in Railway service settings does not match the Dockerfile's exposed port (nginx listens on 80).

**Fix**: Service → Settings → Networking → Target Port = `80`.

### 4.2 Vite vars not baked

**Symptom**: Web loads but URLs are empty or contain literal `undefined`.

**Cause**: `VITE_*` variables must exist **at build time**, not just at runtime. Railway passes them as build args automatically only when they're declared as Service Variables (not Shared, not Project).

**Fix**:
1. Confirm vars are under the web service's Variables tab, scope = Service.
2. Confirm the Dockerfile declares them as `ARG`.
3. Trigger a redeploy (rebuild — not just restart).

### 4.3 R2 SSL alert 40

**Symptom**: API logs show `EPROTO ... SSL alert 40` when trying to upload to R2.

**Cause**: `R2_ACCOUNT_ID` is wrong, producing an invalid endpoint hostname. Often confused with `R2_ACCESS_KEY_ID`.

**Fix**: Verify `R2_ACCOUNT_ID` in the Cloudflare Dashboard (top right of any account screen, 32-char hex). It is **different** from `R2_ACCESS_KEY_ID` (which is generated when you create an R2 API Token).

### 4.4 Script shebang CRLF

**Symptom**: Web container in restart loop, error `/docker-entrypoint.d/99-config.sh: not found` even though the file exists.

**Cause**: The `.sh` file has Windows line endings (CRLF) instead of LF. Linux reads the shebang as `#!/bin/sh\r`, tries to find an interpreter literally named `/bin/sh\r`, fails, returns `exit 127`.

**Diagnosis**:
```bash
head -1 entrypoint.sh | od -c | head -1
# If you see "\r \n" at the end, that's the bug
```

**Fix**:
```bash
sed -i 's/\r$//' apps/web/entrypoint.sh
```

**Preventive**: the repo's `.gitattributes` already forces LF for `*.sh`, `*.envsh`, `Dockerfile`, `nginx.conf`, `*.conf.template`, `docker-compose*.yml`. Make sure new contributors clone with that file present.

---

## 5. Audit & operations

### 5.1 Audit environment defaults to dev

**Symptom**: Audit log dashboard shows `environment: dev` for operations on PROD connections.

**Cause**: Known limitation. The `AuditInterceptor` reads `environment` from the request body/params. For operations that don't include it (e.g., reads), it defaults to `dev`. See [security-model.md §3 limitation 1](security-model.md#known-limitations).

**Permanent fix**: requires a migration to make `AuditLogEntity.environment` nullable, then update the interceptor to write `null` instead of defaulting. Not done today.

**Workaround**: filter the dashboard by `resourceId` (the connection UUID) and cross-reference with the connection's actual environment.

---

## Still stuck?

1. **Check the logs**:
   - Local: `pnpm dev` output, or `docker compose logs -f api web`.
   - Railway: Service → Deployments → click latest → View Logs.

2. **Check the database**:
   ```sql
   SELECT * FROM backup_jobs ORDER BY created_at DESC LIMIT 10;
   SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;
   SELECT * FROM cronjobs WHERE is_active = true;
   ```

3. **Reach out**: open an issue at the repo with logs, env scrubbed of secrets, and the exact steps that lead to the failure.
