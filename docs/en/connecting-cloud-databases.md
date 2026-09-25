# Connecting to Cloud (Managed) Databases

> 🇪🇸 Versión en español: [../es/connecting-cloud-databases.md](../es/connecting-cloud-databases.md)

This guide is for DevOps users who want to register a **managed/cloud database** (Neon, AWS RDS, Supabase, Azure Database for PostgreSQL, Google Cloud SQL, Railway Postgres, etc.) as a EnVault Management connection.

> **Scope**: this covers the **managed databases you back up**, not EnVault Management's own control DB. The control DB must always be PostgreSQL 16+ — see the requirements section of the [README](../../README.md).

---

## 1. What EnVault Management does (and does NOT) do today

Read this before you spend an hour debugging.

| Capability | Status |
|------------|--------|
| Direct TCP connection to PostgreSQL / MySQL | ✅ Native |
| SSL/TLS handshake | ⚠️ **Via connection-string params** (`sslmode=require`, etc.) — EnVault Management does not validate or pin certificates itself |
| Custom CA / client certificates | ❌ Not exposed via the UI today |
| SSH tunneling | ❌ Not native — handle externally (see [on-prem guide](connecting-on-premise-databases.md)) |
| Connection pooling (pgBouncer) | ➕ Use the provider's pooled endpoint directly |
| IP allowlist validation | ❌ Not validated by EnVault Management — handled at the provider |
| Connection retries / backoff | ❌ Single attempt with a 5-second timeout |

**Bottom line**: SSL works if the underlying driver respects the connection-string parameters (it does, for both `pg` and `mysql2`). What's missing is **first-class UI/configuration support** for SSL options and tunneling. See [architecture-roadmap.md](architecture-roadmap.md) for the planned design.

---

## 2. Prerequisites — checklist

Before you register a cloud DB connection, confirm:

- [ ] You have host, port, database name, username, and password.
- [ ] The user has the minimum permissions per engine ([flow doc, §permissions](flow-database-management.md#minimum-user-permissions-per-engine)).
- [ ] The DB is reachable from the network where EnVault Management runs (public endpoint, or VPC peering, or private endpoint resolvable from EnVault Management's host).
- [ ] The IP of the host running EnVault Management is on the provider's allowlist (if the provider uses one — most managed DBs do).
- [ ] You know whether the provider enforces SSL (most modern ones do — Neon and Supabase enforce it always).

---

## 3. Provider-specific recipes

### 3.1 Neon (Postgres serverless)

Neon **always enforces SSL** and supports both pooled and direct endpoints.

**Connection string format** (from Neon dashboard → Connection Details):

```
postgresql://<user>:<password>@<endpoint>.neon.tech/<database>?sslmode=require
```

For pooled connections (recommended for long-running queries like `pg_dump`):

```
postgresql://<user>:<password>@<endpoint>-pooler.neon.tech/<database>?sslmode=require
```

**When registering in EnVault Management UI**, the fields decompose like this:

| Field | Value |
|-------|-------|
| Host | `<endpoint>.neon.tech` or `<endpoint>-pooler.neon.tech` |
| Port | `5432` |
| Database | `<database>` |
| Username | `<user>` |
| Password | `<password>` |
| DB Type | `postgres` |

**The `sslmode=require` part**: EnVault Management's UI does not have a field for it. The `pg` driver under the hood reads connection options from the host string only, **not** from a separate `sslmode` field that doesn't exist in the form. **Workaround today**: if your provider mandates SSL and rejects non-SSL connections, the connection will fail until SSL handling is exposed natively (see roadmap). For Neon specifically, this means raw connections from EnVault Management **will fail today** with `SSL required` errors.

> **Honest status**: Neon, Supabase and any provider that mandates SSL are not fully supported by the current EnVault Management code path. You can work around it by self-hosting a Postgres proxy that terminates SSL, or wait for the native SSL feature. Track this in [architecture-roadmap.md](architecture-roadmap.md).

### 3.2 AWS RDS / Aurora (Postgres or MySQL)

RDS is **the friendliest target today** because SSL can be optional or required depending on your parameter group.

**If your RDS does NOT enforce SSL** (default unless you toggled `rds.force_ssl=1` in the parameter group):

| Field | Value |
|-------|-------|
| Host | `<instance>.<region>.rds.amazonaws.com` |
| Port | `5432` (Postgres) / `3306` (MySQL) |
| Database | your DB name |
| Username | master user or a dedicated backup user |
| Password | from Secrets Manager or whatever vault you use |
| DB Type | `postgres` or `mysql` |

**Network requirements**:

- The EnVault Management host must be inside the RDS VPC, or use VPC peering, or you must enable public accessibility on the RDS instance AND add the EnVault Management host's egress IP to the security group inbound rules.
- **For production we strongly recommend VPC peering or PrivateLink**, not public accessibility. Exposing an RDS instance to the public internet is a compliance/audit red flag even with SSL.

**If your RDS enforces SSL**: same limitation as Neon today — wait for the native SSL feature or terminate SSL outside EnVault Management.

### 3.3 Supabase

Supabase always enforces SSL, identical constraint to Neon. Use the **pooler** endpoint (`aws-0-<region>.pooler.supabase.com:6543`) and a database role with `SELECT` privileges.

Status: same as Neon — blocked on native SSL support.

### 3.4 Azure Database for PostgreSQL / MySQL

Azure enforces SSL by default on the Flexible Server tier. Same blocker — native SSL needed. On the Single Server tier (deprecated), SSL can be turned off via the firewall settings, which makes it work today but is **not** recommended for production.

### 3.5 Google Cloud SQL

Cloud SQL supports both SSL-required and SSL-optional modes. If SSL is set to **"Allow non-SSL connections"** in the instance settings, EnVault Management connects fine. Otherwise, same blocker.

For private IP setup: ensure EnVault Management runs inside the same VPC or in a peered network.

### 3.6 Railway Postgres (plugin)

Railway's Postgres plugin gives you reference variables (`${{Postgres.PGHOST}}` etc.). It does **not** enforce SSL on internal connections within the same project, so it works today without workarounds.

| Field | Value |
|-------|-------|
| Host | `${{Postgres.PGHOST}}` (or external proxy if connecting from outside Railway) |
| Port | `${{Postgres.PGPORT}}` |
| Database | `${{Postgres.PGDATABASE}}` |
| Username | `${{Postgres.PGUSER}}` |
| Password | `${{Postgres.PGPASSWORD}}` |

For external access (EnVault Management hosted outside Railway), use the public TCP proxy that Railway exposes — same credentials, different host/port.

---

## 4. Network topologies — pick one

```
┌──────────────────────────────────────────────────────────────────┐
│  Option A: Public endpoint + IP allowlist (simplest)             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐  HTTPS   ┌─────────┐  TCP   ┌──────────────────┐  │
│   │ EnVault Management  │ ────────▶│ Provider│ ──────▶│ Managed DB (pub) │  │
│   │  (any    │          │   API   │        │  with allowlist  │  │
│   │  cloud)  │ ◀────────│         │ ◀──────│  of EnVault Management IP   │  │
│   └──────────┘          └─────────┘        └──────────────────┘  │
│                                                                  │
│  ✅ Fastest to set up                                            │
│  ⚠️  Public endpoint = audit/compliance scrutiny                 │
│  ⚠️  Requires SSL for any sensitive data                         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Option B: Same VPC (recommended for production)                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌────────────────── VPC / VNet ──────────────────┐             │
│   │  ┌──────────┐                ┌──────────────┐  │             │
│   │  │ EnVault Management  │ ─── private ──▶│  Managed DB  │  │             │
│   │  │ instance │     subnet     │  (private IP)│  │             │
│   │  └──────────┘                └──────────────┘  │             │
│   └────────────────────────────────────────────────┘             │
│                                                                  │
│  ✅ No public exposure                                           │
│  ✅ Lower latency, fewer hops                                    │
│  ⚠️  Requires EnVault Management to run in the cloud account                │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Option C: VPC peering / PrivateLink (cross-account)             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌── VPC A ──┐                              ┌── VPC B ──┐       │
│   │ EnVault Management   │ ◀──── peering / PL ────────▶│ Managed DB│       │
│   └───────────┘                              └───────────┘       │
│                                                                  │
│  ✅ Production-grade for multi-account orgs                      │
│  ⚠️  More setup (route tables, security groups, DNS)             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Testing a connection before saving

EnVault Management has a `POST /connections/test-raw` endpoint that tries the connection with a 5-second timeout. From the UI, the "Test Connection" button in the create-connection form hits it.

If the test fails, the error message comes straight from the driver. Common ones:

| Driver error | Real cause | Fix |
|--------------|------------|-----|
| `connection timeout` after 5s | Network unreachable, wrong host, security group blocking | Test with `pg_isready -h <host> -p <port>` from the EnVault Management host. Check firewall/SG rules. |
| `password authentication failed` | Wrong user/password, or user doesn't exist | Verify the password by connecting with `psql` or `mysql` CLI from the same machine. |
| `SSL connection is required` | Provider enforces SSL, EnVault Management does not pass `sslmode=require` | **Blocked today** — see §3.1 / roadmap. |
| `database "X" does not exist` | Typo, or user has no `CONNECT` privilege on that DB | `\l` in psql to list databases visible to the user. |
| `role "X" cannot login` | User exists but `NOLOGIN` | `ALTER ROLE X LOGIN;` |
| `no pg_hba.conf entry for host` | Provider's host-based auth rejects the source IP | Add the EnVault Management host's egress IP to the allowlist. |

---

## 6. Operational tips

- **Use a dedicated user per EnVault Management connection.** Not the admin/master user. Grant only the minimum required permissions. If credentials leak, blast radius is bounded.
- **Rotate passwords periodically.** Today, EnVault Management stores them in plaintext in the control DB ([security-model.md, §4](security-model.md#4-connection-credentials)) — rotation is your defence-in-depth.
- **Tag connections with descriptive names.** `prod-billing-postgres` is better than `db1`. Names appear in audit logs and backup history.
- **Pin the engine version**, when possible. `pg_dump` versions must be ≥ the source server version. If your managed DB runs Postgres 16 and the EnVault Management container ships `pg_dump` 15, dumps will fail with a version error.
- **Monitor egress costs.** Cross-region or cross-AZ traffic from your managed DB to EnVault Management's host is billable on most providers. Co-locate when possible.

---

## 7. What's coming (roadmap, not implemented)

See [architecture-roadmap.md](architecture-roadmap.md) for the design. Headline items:

- Native SSL configuration (mode, CA cert, client cert) in the UI and DB schema.
- SSH tunnel support natively integrated.
- Per-engine driver abstraction (Postgres / MySQL / MongoDB / MSSQL).
- Connection allowlist validation (block `localhost`, `169.254.x.x`, etc.).
