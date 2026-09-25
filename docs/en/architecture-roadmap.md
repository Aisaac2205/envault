# Architecture Roadmap

> ⚠️ **STATUS: PROPOSED DESIGN — NOT IMPLEMENTED**
>
> This document describes the **target architecture** for EnVault Management's connection layer. As of 2026-05-14, the codebase implements **direct TCP connections only**, without first-class SSL, SSH tunneling, or driver abstraction. See [architecture.md](architecture.md) for the current implementation.
>
> The purpose of this document is to give DevOps users and contributors a clear picture of **where the project is heading**, so that:
> 1. Design decisions made today are compatible with the target.
> 2. Contributors know what to build next without re-inventing the design.
> 3. Users evaluating EnVault Management can judge whether the trajectory matches their needs.

> 🇪🇸 Versión en español: [../es/architecture-roadmap.md](../es/architecture-roadmap.md)

---

## 1. Motivation

Today's connection layer has three problems:

1. **No first-class SSL/TLS support.** Managed providers that enforce SSL (Neon, Supabase, Azure Flexible Server, RDS with `force_ssl`) cannot be used without workarounds. See [connecting-cloud-databases.md §3](connecting-cloud-databases.md#3-provider-specific-recipes).

2. **No SSH tunneling.** On-prem DBs require external tunnel setup (autossh, systemd units, sidecars). See [connecting-on-premise-databases.md §4](connecting-on-premise-databases.md#4-pattern-c--ssh-tunnel-via-bastion--jump-host).

3. **Engine support is hard-coded.** Adding MongoDB or MSSQL requires touching backup, restore, and test logic in multiple places. Each new engine is a non-trivial PR.

The proposed design solves all three with two abstractions: **`ConnectionDriver`** (per engine) and **`Transport`** (per network strategy). They are orthogonal — you can combine Postgres with SSL with SSH tunneling without writing combinatorial code.

---

## 2. Target architecture

### 2.1 Folder layout (proposed)

```
apps/api/src/modules/connections/
├── drivers/
│   ├── connection-driver.interface.ts   ← contract
│   ├── postgres.driver.ts
│   ├── mysql.driver.ts
│   ├── mongodb.driver.ts                ← future
│   └── mssql.driver.ts                  ← future
│
├── transport/
│   ├── transport.interface.ts            ← contract
│   ├── direct.transport.ts               ← raw TCP (what we have today)
│   ├── ssl.transport.ts                  ← TCP + TLS handshake
│   └── ssh-tunnel.transport.ts           ← TCP via SSH local forwarding
│
├── connection.service.ts                 ← orchestrates driver + transport
└── connection.factory.ts                 ← resolves driver + transport from entity
```

### 2.2 The `ConnectionDriver` contract

```ts
// drivers/connection-driver.interface.ts
export interface ConnectionDriver {
  readonly engine: 'postgres' | 'mysql' | 'mongodb' | 'mssql';

  /** Tests a connection without persisting. Returns latency or error. */
  testConnection(opts: ConnectionOptions, transport: Transport): Promise<TestResult>;

  /** Streams a dump to a writable stream. */
  dump(opts: ConnectionOptions, transport: Transport, out: NodeJS.WritableStream): Promise<DumpStats>;

  /** Restores a dump from a readable stream. */
  restore(opts: ConnectionOptions, transport: Transport, in_: NodeJS.ReadableStream): Promise<RestoreStats>;

  /** Lists databases visible to the connecting user. */
  listDatabases(opts: ConnectionOptions, transport: Transport): Promise<string[]>;

  /** Validates the user has the minimum required privileges. */
  validateCredentials(opts: ConnectionOptions, transport: Transport): Promise<PermissionReport>;
}
```

Each driver is small and focused — no shared mutable state, easy to unit-test.

### 2.3 The `Transport` contract

```ts
// transport/transport.interface.ts
export interface Transport {
  readonly kind: 'direct' | 'ssl' | 'ssh-tunnel';

  /** Resolves the effective host/port the driver should connect to. */
  resolve(opts: ConnectionOptions): Promise<{ host: string; port: number }>;

  /** Sets up resources (tunnel, TLS context) before the driver connects. */
  setup(): Promise<void>;

  /** Tears down resources after the driver disconnects. */
  teardown(): Promise<void>;

  /** Returns driver-specific options (e.g., `pg` SSL config). */
  driverOptions(): Record<string, unknown>;
}
```

- **`DirectTransport`**: `resolve()` returns the connection's host/port as-is. `setup/teardown` are no-ops.
- **`SslTransport`**: `resolve()` returns the same, but `driverOptions()` injects `{ ssl: { rejectUnauthorized: true, ca: <pem>, ... } }` into the driver config.
- **`SshTunnelTransport`**: `setup()` opens an SSH connection (using `ssh2`) and a local port forward; `resolve()` returns `localhost:<local-port>`; `teardown()` closes the tunnel.

### 2.4 The orchestration layer

```ts
// connection.service.ts (sketch)
async test(connection: ConnectionEntity): Promise<TestResult> {
  const driver = this.factory.driverFor(connection.engine);
  const transport = this.factory.transportFor(connection);

  await transport.setup();
  try {
    return await driver.testConnection(connection.toOptions(), transport);
  } finally {
    await transport.teardown();
  }
}
```

This is the entire public-facing change. Existing callers of `connection.service.ts` don't see anything different.

---

## 3. Data model changes (proposed)

The `connections` table gains three optional JSONB columns. Existing rows are unaffected — `NULL` columns mean "use direct transport with no SSL", which matches today's behavior exactly.

```sql
ALTER TABLE connections
  ADD COLUMN ssl_config JSONB NULL,
  ADD COLUMN ssh_tunnel_config JSONB NULL,
  ADD COLUMN network_options JSONB NULL;
```

### 3.1 `ssl_config` shape

```ts
type SslConfig = {
  mode: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  ca?: string;          // encrypted at rest
  clientCert?: string;  // encrypted at rest
  clientKey?: string;   // encrypted at rest
};
```

### 3.2 `ssh_tunnel_config` shape

```ts
type SshTunnelConfig = {
  host: string;
  port: number;
  user: string;
  authMethod: 'password' | 'privateKey';
  credential: string;   // encrypted at rest (password or PEM key)
  passphrase?: string;  // for encrypted keys
};
```

### 3.3 `network_options` shape

```ts
type NetworkOptions = {
  connectTimeoutMs: number;       // default 5000
  statementTimeoutMs: number;     // default 0 (no limit)
  keepAlive: boolean;             // default true
};
```

### 3.4 Encryption at rest

This is the **prerequisite** to landing the rest. The existing `connections.password` is plaintext today ([security-model.md §4](security-model.md#4-connection-credentials)). Adding more secrets (CA certs, SSH keys) without encrypting first amplifies the breach surface.

Proposed approach: AES-256-GCM with a key derived from a secret env var (`ENVAULT_CREDENTIAL_KEY`). Migration step:
1. Add encrypted columns alongside plaintext ones (`password_encrypted`, etc.).
2. Backfill on first read/write of each connection.
3. After all rows are migrated, drop plaintext columns.

This is its own change with its own SDD process — do not bundle with the driver refactor.

---

## 4. Roadmap (ordered, with rough dependencies)

The order matters. Each step builds on the previous one.

### Phase 1 — Foundation (no user-visible changes)

| Item | Outcome | Why first |
|------|---------|-----------|
| Introduce `ConnectionDriver` interface | Extract Postgres/MySQL into separate driver files | No behavior change, just refactoring |
| Introduce `Transport` interface with `DirectTransport` only | Wrap current direct TCP behavior | Same as above — refactor, no new functionality |
| Add credential encryption at rest | `password` is encrypted; UI/API unchanged | Required before adding more secrets |

### Phase 2 — SSL support

| Item | Outcome |
|------|---------|
| Add `SslTransport` implementation | Postgres + SSL works end-to-end with `sslmode` |
| Add UI fields for SSL config | Users can pick mode and provide certs |
| Migrate `connections` table to add `ssl_config` column | New connections can use SSL natively |
| Documentation: update [connecting-cloud-databases.md](connecting-cloud-databases.md) | Neon, Supabase, RDS with SSL move from "blocked" to "supported" |

### Phase 3 — SSH tunneling

| Item | Outcome |
|------|---------|
| Add `SshTunnelTransport` using `ssh2` library | Tunnels are managed inside EnVault Management |
| Add UI fields for SSH config | Users provide bastion host, key, etc. |
| Add `ssh_tunnel_config` column | Persists per-connection tunnel config |
| Documentation: update [connecting-on-premise-databases.md](connecting-on-premise-databases.md) | SSH tunnel pattern moves from "external" to "native" |

### Phase 4 — Additional engines

| Item | Outcome |
|------|---------|
| `MongoDriver` implementation | EnVault Management backs up MongoDB collections |
| `MssqlDriver` implementation | EnVault Management backs up SQL Server databases |
| UI: engine picker shows all four | Users can register Mongo / MSSQL connections |
| `pg_dump` / `mysqldump` / `mongodump` / `sqlpackage` binaries shipped in API container | Multi-binary base image |

### Phase 5 — Operational hardening (independent of driver work)

| Item | Outcome |
|------|---------|
| Per-connection allowlist validation | Reject `localhost`, link-local addresses unless explicitly allowed |
| Retries with exponential backoff | Transient network errors don't fail jobs |
| `/metrics` endpoint (Prometheus) | Observability beyond container stats |
| Structured JSON logs | Better integration with log aggregators |
| BullMQ + Redis scheduler | Multi-replica scheduling without duplicate jobs |

---

## 5. Non-goals

Things explicitly out of scope for this roadmap:

- **EnVault Management as a multi-tenant SaaS.** EnVault Management is a self-hostable tool. Tenancy/billing/SSO-per-tenant is a different product.
- **Replacing `pg_dump` / `mysqldump` with custom protocol implementations.** Native CLI tools are battle-tested. Reinventing them adds risk without benefit.
- **Replacing TypeORM.** TypeORM is fine for the control DB. The driver abstraction is for managed-DB access, not the control DB.
- **Generic ETL / data movement.** EnVault Management does dump/restore, not selective row migration. Tools like `pgloader` or Airbyte exist for that.

---

## 6. How to contribute to the roadmap

The roadmap is **prioritized but not committed**. If you want to work on something:

1. Open a GitHub issue with the proposed scope.
2. Wait for maintainer feedback on whether the priority/scope is right.
3. If aligned, the issue becomes the SDD change proposal (using the project's `/sdd-new` workflow).
4. Implementation follows specs → design → tasks → apply → verify → archive.

Driver refactors are **structural**: they require migrations of existing connections and changes to backup/restore flow. Treat them as multi-PR efforts, not one-shot patches.

---

## 7. Honest assessment for evaluators

If you are evaluating EnVault Management today and the gaps in §1 are deal-breakers (SSL especially), **be honest with yourself about your timeline**. The roadmap is real but the work is not done. Two options:

1. **Use EnVault Management today for connections that don't need SSL/tunneling** (e.g., same-VPC connections, dev/test environments).
2. **Wait for Phase 2** if SSL is mandatory for your compliance posture.

Avoid the trap of adopting a tool because the roadmap looks good — adopt it because what exists today meets your needs, and the roadmap aligns with where you want it to go.
