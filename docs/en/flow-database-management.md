# Database Management Flow

> 🇪🇸 Versión en español: [../es/flow-database-management.md](../es/flow-database-management.md)

## What is a "connection"?

A connection (`ConnectionEntity`) represents a database registered in the system. It is the unit on which **backup**, **restore** and **cronjobs** operate.

It's not the database itself — it's **the pointer with credentials** to access it.

---

## Required fields at registration time

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string (max 100) | yes | Human-readable identifier |
| `environment` | `prod` \| `dev` \| `sqa` | yes | Drives the applicable security rules |
| `dbType` | `postgres` \| `mysql` | no (default `postgres`) | Determines the engine and tooling used |
| `host` | string | yes | Hostname or IP |
| `port` | 1–65535 | yes | Engine port |
| `database` | string | yes | Database name inside the engine |
| `username` | string | yes | User with role-appropriate permissions |
| `password` | string | yes | Stored as plaintext, excluded from responses via `@Exclude()` |

### Minimum user permissions per engine

- **PostgreSQL**: user with `CONNECT` privilege; `pg_dump` requires `SELECT` on every table to back up.
- **MySQL**: user with `SELECT`, `LOCK TABLES`, `SHOW VIEW`, `EVENT`, `TRIGGER`.

> **Heads up — SSL/TLS**: the codebase does not handle SSL/TLS explicitly today. Connections are direct TCP. If your managed DB requires SSL (Neon, RDS with SSL enforced, etc.), append the appropriate driver-level params to the connection string (e.g. `?sslmode=require` for Postgres). See [connecting-cloud-databases.md](connecting-cloud-databases.md) and [architecture-roadmap.md](architecture-roadmap.md).

---

## Endpoints

```
GET    /connections             List every active connection
GET    /connections/:id         Get a specific connection
POST   /connections             Create a connection (any environment)
PATCH  /connections/:id         Update a connection (BLOCKED if PROD)
DELETE /connections/:id         Delete a connection (PROD: admin step-up, see below)
POST   /connections/test        Test a connection by ID in the body
POST   /connections/:id/test    Test a connection by ID in the URL
POST   /connections/test-raw    Test credentials without saving a connection
```

```
GET    /backups/history                History of jobs enriched with the connection name
POST   /backups                        Creates a backup (connectionId in the body)
POST   /backups/trigger/:connectionId  Manual trigger by connectionId (no body)
PUT    /backups/settings/:connectionId Configures or updates that connection's cronjob
GET    /backups/r2                     Lists raw objects in R2
GET    /backups/:id                    Gets a backup job by ID
```

Every endpoint requires a valid session (Better Auth).

---

## PROD rules (security invariants)

A connection with `environment === 'prod'` is **immutable** from the API: it cannot be edited or reclassified, and an admin can only delete it with a step-up confirmation:

| Action | PROD | DEV / SQA |
|--------|------|-----------|
| Create (`POST`) | ✅ | ✅ |
| Read (`GET`) | ✅ | ✅ |
| Test connection | ✅ | ✅ |
| Edit (`PATCH`) | ❌ `403 Forbidden` | ✅ (setting `environment` to `prod`: ❌ `403 Forbidden`) |
| Delete (`DELETE`) | 🔐 exact name + admin password ([security-model §1.1](security-model.md#11-prod-connections-are-immutable-from-the-api)) | ✅ |
| Back up from it | ✅ | ❌ `400 BadRequest` |
| Restore into it | ❌ `403 Forbidden` | ✅ |

**Why:** PROD is the source of truth. Modifications to a PROD connection happen via **infrastructure/DBA** directly, not via the application. This prevents a user with API permissions from pointing the backup job at a rogue host.

### What if I legitimately need to remove or replace a PROD connection?

An admin deletes it from the app with a step-up confirmation: the `DELETE` body carries the exact connection name (`confirmName`) and the admin's current password (`password`), and the web app asks for both in a confirmation dialog. 5 wrong passwords in 15 minutes answer `429`. The delete is a soft delete that never touches the production database, and it is audited like any other mutation.

Since editing stays blocked, new credentials or a corrected host mean a new PROD connection: see [devops-runbook §3.2](devops-runbook.md#32-rotate-credentials-or-fix-the-host-of-a-connection). Once the old connection is deleted, the app can no longer restore the dumps stored under its slug.

---

## Connection testing

There are two modes:

### By ID (already saved connection)

```http
POST /connections/:id/test
POST /connections/test    { "connectionId": "..." }
```

### Raw (without saving — useful while filling the form)

```http
POST /connections/test-raw
{
  "host": "...", "port": 5432, "database": "...",
  "username": "...", "password": "...", "dbType": "postgres"
}
```

Both return:

```json
{ "success": true, "latencyMs": 47 }
```

```json
{ "success": false, "latencyMs": 5023, "error": "password authentication failed for user 'foo'" }
```

The test uses the engine's native client (`pg.Client` for Postgres, `mysql2/promise` for MySQL), not the CLI tools. Fixed timeout of **5 seconds**.

---

## Lifecycle

```
                  ┌──────────────────────┐
                  │  POST /connections   │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  ConnectionEntity    │
                  │  isActive: true      │
                  └──────────┬───────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     environment=prod   env=dev/sqa   POST /:id/test
              │              │              │
              ▼              ▼              ▼
     ┌─────────────┐  ┌─────────────┐  ┌──────────┐
     │ Backup only │  │ Backup ❌    │  │ Verifies │
     │ Read only   │  │ Restore ✅   │  │ creds    │
     │ + test      │  │ Edit ✅      │  └──────────┘
     │ Delete 🔐    │  │ Delete ✅    │
     └─────────────┘  └─────────────┘
              │              │
              ▼              ▼
     POST /backups    POST /restores
     (creates dump)   (consumes dump)
              │              ▲
              ▼              │
        Cloudflare R2 ───────┘
```

---

## Backup history

`GET /backups/history` returns jobs enriched with the connection name:

```json
[
  {
    "id": "...",
    "connectionId": "...",
    "connectionName": "prod-postgres",
    "environment": "prod",
    "status": "completed",
    "fileKey": "backups/.../2026-05-07T02-00-00.dump",
    "fileSizeMb": 142.7,
    "startedAt": "2026-05-07T02:00:00.000Z",
    "completedAt": "2026-05-07T02:01:23.000Z",
    "errorMessage": null,
    "createdAt": "2026-05-07T02:00:00.000Z"
  }
]
```

If the connection was deleted (soft delete), `connectionName` returns `"(deleted)"`.

---

## Operational notes

- **Soft delete**: when `DELETE` is applied to a connection (to a PROD one only with step-up confirmation), it is not physically removed — it's marked `isActive: false`. Historical backups/restores referencing it remain queryable, but its dumps can no longer be restored through the app.
- **Listing**: `GET /connections` only returns `isActive: true`. There is no endpoint to list soft-deleted ones.
- **Audit**: every `POST`, `PATCH`, `DELETE` is recorded in `audit_logs` with `userId`, `userEmail`, `action`, `metadata` (the full body) and `environment`.
- **Streams**: the dump is uploaded to R2 via multipart upload (`@aws-sdk/lib-storage`) directly from the process's stdout — no disk writes.
