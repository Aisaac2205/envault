# DevOps Runbook

> 🇪🇸 Versión en español: [../es/devops-runbook.md](../es/devops-runbook.md)

Operational guide for running EnVault Management in production. Covers what to monitor, what to back up, how to rotate, how to respond to common incidents. Lean toward "do this on day one, you'll thank yourself on day ninety".

---

## 1. Pre-production checklist

Before flipping the switch on a production deployment, confirm:

### Infrastructure

- [ ] EnVault Management API and Web are running on a single replica each (multi-replica breaks the scheduler — see [scheduler-architecture.md](scheduler-architecture.md))
- [ ] The control PostgreSQL DB is **dedicated** (not shared with other apps)
- [ ] The control DB has automated backups configured (EnVault Management does NOT back up itself)
- [ ] HTTPS is terminated in front of the web service (Railway does this automatically; for self-host, use Caddy/nginx/Traefik)
- [ ] `CORS_ORIGIN` is set to the exact frontend domain (no wildcards)
- [ ] `NODE_ENV=production` is set on the API service

### Secrets

- [ ] R2 credentials are **dedicated** to EnVault Management (not shared with other apps)
- [ ] R2 bucket has **versioning enabled** (defence against accidental deletion)
- [ ] `BETTER_AUTH_SECRET` is stored in a secrets manager, not in `.env`
- [ ] No `.env` files are committed (`git log --all --full-history -- '*.env'` should be empty)

### Auth

- [ ] `BETTER_AUTH_SECRET` is set and is at least 32 bytes of random entropy
- [ ] `BETTER_AUTH_URL` matches the public API domain (used for cookie domain/CORS)
- [ ] Admin seed user exists (check via `/api/auth/admin/users` or query the `user` table)
- [ ] At least one non-admin user has been created and can log in successfully

### Application

- [ ] `InitialSchema` migration has been generated (see [database-migrations.md](database-migrations.md))
- [ ] `/health` endpoint returns 200 from the deployed environment
- [ ] At least one connection is registered and tested
- [ ] One end-to-end backup → restore-to-DEV cycle was completed successfully

---

## 2. What to monitor

### Critical alerts (page someone immediately)

| Metric | Threshold | Why |
|--------|-----------|-----|
| API `/health` status | Non-200 for > 2 min | EnVault Management is down |
| Control DB connection count | At >80% of `max_connections` | Connection leak or scale issue |
| R2 4xx error rate | Sustained for > 5 min | Credentials revoked, bucket misconfigured |
| Backup job failure rate | > 20% in last hour | Pattern of failures, not a one-off |

### Warning alerts (acknowledge within a few hours)

| Metric | Threshold | Why |
|--------|-----------|-----|
| Backup job duration | 2× the 7-day rolling average | DB growth, network slowdown |
| R2 bucket size growth | Sudden spike or sudden flatline | Misconfigured retention or stuck jobs |
| Cronjob `nextRunAt` | More than 1 hour in the past with `isActive: true` | Scheduler is not firing |
| Audit log volume | Order-of-magnitude change | Either a bug or a security event |

### Recommended dashboard panels

- API 5xx rate (last 24h)
- Backup job status distribution (completed / failed / running) over time
- R2 bucket size and object count
- Active connections by environment
- Recent audit log entries with filter by user

For Prometheus/Grafana stacks, EnVault Management does **not** currently expose `/metrics`. Track at the infra layer (container stats, DB pg_stat_*).

---

## 3. Routine operations

### 3.1 Add a new managed DB connection

1. Verify connectivity from the EnVault Management host (`nc -zv <host> <port>`) — see [troubleshooting §2](troubleshooting.md#2-database-connections).
2. Create a dedicated DB user with minimum permissions ([flow-database-management.md §permissions](flow-database-management.md#minimum-user-permissions-per-engine)).
3. Register the connection via the EnVault Management UI.
4. Test the connection from the UI.
5. Trigger one manual backup; verify it appears in R2 and in the backup history.
6. Configure the cronjob schedule.

### 3.2 Rotate connection credentials

Today there is no built-in rotation. Manual procedure:

1. On the source DB, create a new user with the same permissions as the old one.
2. In EnVault Management: register a NEW connection with the new credentials (do **not** edit the existing PROD connection — PROD edits are blocked by design).
3. Migrate cronjobs to point at the new connection (via UI).
4. Run a verification backup.
5. Once stable, leave the old connection in place (soft-delete it if non-PROD; PROD connections cannot be deleted).
6. On the source DB, drop the old user.

### 3.3 Rotate EnVault Management's own DB password

1. In the control DB: `ALTER USER envault_control WITH PASSWORD 'new-strong-password';`
2. Update `DATABASE_URL` in the API service config.
3. Redeploy (rolling restart fine, single replica).
4. Confirm `/health` returns 200.

### 3.4 Rotate R2 credentials

1. In Cloudflare Dashboard → R2 → Manage R2 API Tokens → create new token with `Object Read & Write` scope on the EnVault Management bucket.
2. Update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in the API service config.
3. Redeploy.
4. Trigger a manual backup; confirm it lands in R2.
5. Delete the old token from Cloudflare.

### 3.5 Restore a dump to a non-PROD target

1. From EnVault Management UI → Restore → pick the dump from R2.
2. Pick the target connection (must be DEV or SQA — PROD is blocked).
3. Confirm the type-to-confirm prompt.
4. Monitor the restore job until `completed`.
5. Verify on the target DB by querying a known table.

---

## 4. Incident response playbooks

### 4.1 EnVault Management is completely down

**Triage in this order**:

1. **Is the API container running?**
   ```bash
   docker ps | grep envault-api
   # Or on Railway: Service → Deployments → check status
   ```
2. **Are the logs telling you something?**
   ```bash
   docker logs --tail 200 envault-api
   ```
3. **Is the control DB reachable from the API?**
   ```bash
   docker exec envault-api pg_isready -h <DB_HOST> -p <DB_PORT>
   ```
4. **Is Better Auth responding?**
   ```bash
   curl -I <API_URL>/api/auth/ok
   ```

If 1 fails: restart the container. If 2 shows the API crashed on startup: check [troubleshooting §1.1](troubleshooting.md#11-api-crashes-with-relation-does-not-exist). If 3 fails: the DB is down or network is broken. If 4 fails: Better Auth is not responding — check that `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set correctly and the API has DB access.

### 4.2 Backups suddenly all failing

1. Check error messages on the last 5 failed jobs: are they all the same error?
2. If "`pg_dump` version mismatch": [troubleshooting §3.2](troubleshooting.md#32-pg_dump-version-mismatch).
3. If "connection timeout": did the DB provider change something? Check provider's status page.
4. If R2 errors: check Cloudflare status page, then check credentials.
5. If something stranger: open API logs and look at the actual stack trace.

### 4.3 R2 bucket near quota

1. List old dumps:
   ```sql
   SELECT file_key, file_size_mb, created_at
   FROM backup_jobs
   WHERE status = 'completed' AND created_at < NOW() - INTERVAL '90 days'
   ORDER BY created_at;
   ```
2. Decide retention policy with stakeholders.
3. Today there is no automated cleanup. Manual deletion:
   - From the Cloudflare R2 UI (slow, painful for many objects).
   - Or with `rclone` / `aws s3` CLI against the R2 endpoint.
4. After deletion, update `backup_jobs` rows to mark them archived/deleted (or leave them as historical records — `connectionName` will still show `(deleted)` if the source connection is gone).

### 4.4 Suspicious activity in audit logs

1. Filter audit log by user:
   ```sql
   SELECT * FROM audit_logs WHERE user_id = '<suspect>' ORDER BY created_at DESC LIMIT 100;
   ```
2. Look for patterns: failed PROD modification attempts (good — the guards worked), unusual restore-from-PROD attempts, mass connection creation.
3. If a session was compromised: revoke the session via the Better Auth admin API, or rotate `BETTER_AUTH_SECRET` to invalidate ALL sessions simultaneously. Rotate EnVault Management's R2 credentials as defence in depth.
4. The audit log is **not cryptographically immutable** — a DBA with control-DB access can edit it ([security-model.md §3](security-model.md#3-audit)). Export the suspicious rows to a separate system before investigating, in case they get tampered with.

---

## 5. Backup of the control database itself

**This is the most-skipped step and the most painful when it bites.** EnVault Management backs up your managed DBs. It does NOT back up its own control DB.

If the control DB is lost, you lose:
- Every registered connection (credentials, hosts, names)
- Every cronjob schedule
- The complete audit log history
- The metadata pointing to dumps in R2 (the dumps themselves stay in R2, but you lose the index)

**Minimum acceptable strategy**:
- Daily `pg_dump` of the control DB to a separate location (NOT the same R2 bucket EnVault Management uses — different account or different provider).
- Tested restore procedure (do it once in a staging env, document the steps).
- Retention: at least 30 days of daily backups.

**Production-grade strategy**:
- Continuous archiving (WAL-G, pgBackRest) with point-in-time recovery.
- Cross-region replication of the control DB.
- Quarterly disaster recovery drills.

If you're on Railway: enable Railway's automatic Postgres backups for the control DB plugin. If you're elsewhere: set up `pg_dump` cron on a separate host.

---

## 6. Upgrade / deployment procedure

For a routine deploy (new image version):

1. Verify CI passed on `main` and the image was published.
2. Check the changelog (`CHANGELOG.md` or GitHub Releases) for breaking changes.
3. If there are new migrations: confirm they ran successfully in a non-prod environment first.
4. Deploy the API service first, then the Web service (so the Web hits a compatible API).
5. Watch logs for 5 minutes; if errors, roll back to the previous image tag.
6. Run a smoke test: list connections, trigger one manual backup, verify it appears.

For a major version upgrade:
- Read the migration notes in the release.
- Take a manual backup of the control DB **before** deploying.
- Have a rollback plan documented in writing.

---

## 7. What's NOT yet automated

Things you'd expect to be automated but aren't, today:

- **R2 lifecycle / retention policies** for old dumps
- **Cronjob audit trail** (cronjobs run in-process and don't go through the HTTP audit interceptor)
- **Secret rotation reminders**
- **Health check beyond `/health` 200** (no dependency health, no DB latency check)
- **Metrics endpoint** (`/metrics` for Prometheus)
- **Structured logs in JSON** (logs are currently unstructured nest-style)

These are good candidates for the roadmap — see [architecture-roadmap.md](architecture-roadmap.md).
