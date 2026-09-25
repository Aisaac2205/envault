# EnVault Management

> 🇪🇸 Versión en español: [README.es.md](README.es.md)

Centralized database management platform. Register database connections, run and schedule backups, restore dumps, audit operations and monitor jobs across multiple environments from a single web interface.

---

## Stack

| Layer           | Technology                    | Version |
| --------------- | ----------------------------- | ------- |
| Runtime         | Node.js                       | ≥ 22    |
| Package manager | pnpm workspaces               | ≥ 9     |
| Language        | TypeScript                    | ^5.8.3  |
| Backend         | NestJS                        | ^11.0.7 |
| ORM             | TypeORM                       | ^0.3.20 |
| Frontend        | React                         | ^19.1.0 |
| Build tool      | Vite                          | ^6.3.3  |
| Router          | React Router                  | ^7.5.0  |
| Auth            | Better Auth (native, cookie sessions) | —  |
| Storage         | Cloudflare R2 (S3-compatible) | —       |
| Control DB      | **PostgreSQL 16+ (required)** | —       |
| Queues & Jobs   | Redis 7 + BullMQ (^11.0.3)    | —       |
| Real-time       | Server-Sent Events (SSE)      | —       |

---

## Data Integrity and Verifiable Backups

EnVault Management enforces strict data integrity invariants to eliminate silent dump corruption, partial restores, and disaster recovery blind spots:

1. **In-Flight Cryptographic Hashing**
   Every database dump stream (`pg_dump` or `mysqldump`) computes an unbuffered SHA-256 digest in flight. The digest is persisted in both the control database and the Cloudflare R2 companion manifest v2 (`*.manifest.json`).
2. **Pre-Restore Digest Verification**
   Before piping bytes into a target database, EnVault downloads the dump to isolated staging, computes its SHA-256 digest, and validates it against the recorded database digest using `crypto.timingSafeEqual` (preventing timing attacks and object substitution).
3. **Structural Preflight Check (`pg_restore -l`)**
   The table of contents (TOC) is validated prior to opening connections to the target database. Truncated or malformed dumps abort before modifying destination state.
4. **All-or-Nothing Transactions**
   PostgreSQL restores execute with `--single-transaction`, guaranteeing clean rollback on error. MySQL restores execute via a 4-phase isolated shadow database with atomic table swap.
5. **Cold Disaster Recovery**
   Complete bare-metal runbook and operational sandbox drill scripts ensure platform recoverability from zero. Read [docs/en/disaster-recovery.md](docs/en/disaster-recovery.md).
6. **Two-Stage Coordinated Purge**
   The purge process operates in two coordinated stages to prevent orphan files in cloud storage and inconsistent entries in the control database. First, EnVault issues the physical deletion command to the object storage bucket. Once the cloud provider confirms remote object removal, the platform purges the corresponding job record from the control database.
7. **Non-Destructive Dry-Run Simulation**
   To validate retention policies before executing irreversible deletions, EnVault supports dry-run simulation mode. This operation computes configured retention rules and reports the exact list of candidate dumps, their IDs, and the total storage volume to be reclaimed, without modifying or deleting any remote objects.

---

## Asynchronous Processing Architecture with Redis and BullMQ

EnVault decouples resource-intensive backup and restore operations from HTTP lifecycles using persistent queues powered by BullMQ and Redis 7.

1. **HTTP Decoupling with 202 Accepted Status**
   Requests to trigger backups return immediately with an HTTP 202 Accepted status code and a job identifier. The API registers the task in a PENDING state, publishes the job payload to Redis, and leaves execution to background workers. Clients track live execution progress through Server-Sent Events.

2. **Per-Connection Concurrency Protection**
   To safeguard target databases against connection saturation and CPU spikes, EnVault enforces connection-level isolation. Initiating a new backup while an existing job is PENDING or RUNNING on the same target database returns an HTTP 409 Conflict error. BullMQ workers process tasks with a strict concurrency ceiling of two concurrent jobs per worker instance.

3. **High-Throughput Multipart Streaming to Cloudflare R2**
   Backup execution pipes native dump streams (`pg_dump` and `mysqldump`) directly into Cloudflare R2 without staging intermediate files on local container disks. The multipart uploader divides data streams into 32MB chunks with an internal queue size of four concurrent parts. This design keeps container memory utilization under 128MB while raising single-backup storage ceilings up to 320GB.

4. **Zero Orphan Parts and Backpressure Management**
   Stream transformers enforce backpressure buffers to regulate throughput between database pipes and network sockets. When transfers fail or abort signals trigger, EnVault executes explicit multipart abort commands against the Cloudflare R2 API to immediately purge uncommitted chunks and prevent unreferenced storage costs.

5. **Foundation for Asynchronous Restore Queues**
   The queue architecture extends to disaster recovery workflows. Restore tasks run in isolated worker queues that verify local disk space via staging preflights, validate cryptographic checksums against manifest files, and execute atomic rollbacks upon error.

---

## Requirements (non-negotiable)

The **control database** (the one EnVault Management uses to store its own state, including registered connections, audit log, cronjobs, and dump metadata) **MUST be PostgreSQL 16 or higher**. This is hardcoded into the TypeORM configuration ([`apps/api/src/config/database.config.ts`](apps/api/src/config/database.config.ts)) and relies on Postgres-specific features (enum types, JSONB, defaults). Other engines are not supported and there is no plan to support them for the control DB.

The **managed databases** (the ones your DevOps users register to back up) currently support PostgreSQL and MySQL. See [docs/en/connecting-cloud-databases.md](docs/en/connecting-cloud-databases.md) and [docs/en/connecting-on-premise-databases.md](docs/en/connecting-on-premise-databases.md) for connectivity options, SSL handling, and on-prem patterns.

---

## Architecture and Visual Reference

EnVault Management runs on any platform that can host Docker containers, Redis 7, and a PostgreSQL 16+ instance (cloud PaaS, on-prem servers, air-gapped clusters, or a local workstation).

![Architecture overview](docs/assets/architecture-preview.png)

| Deployment path | Best for | Guide |
|-----------------|----------|-------|
| **PaaS push-deploy** (Railway, Fly.io, Render) | Fast cloud setup, working stack in under an hour | [deployment-railway.md](docs/en/deployment-railway.md) |
| **Self-host / GitOps** (Docker Compose, Kubernetes + ArgoCD) | On-prem, regulated, air-gapped, or private networks | [deployment-self-host.md](docs/en/deployment-self-host.md) |

---

## Monorepo layout

```
vaultly-control/
│
├── apps/
│   ├── api/                     # NestJS — Modular Monolith  :3000
│   └── web/                     # React + Vite — Vertical Slice  :5173 / :80
│
├── docs/
│   ├── en/                      # Technical documentation (English)
│   └── es/                      # Versión en español
│
├── docker-compose.yml      # Docker stack (CI or self-hosted servers)
├── docker-compose.dev.yml  # Dev overrides (hot reload, optional 'test' profile)
│
├── .env                    # Active variables (do not commit)
├── .env.example            # Template — copy to .env
│
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

The monorepo uses **pnpm workspaces** without Turborepo or Nx. Active workspace: `apps/*`.

---

## For DevOps — quick links

| What you need                                     | Where to look                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Run locally from scratch                          | [docs/en/local-development.md](docs/en/local-development.md)                             |
| Deploy to Railway (fast PaaS path)                        | [docs/en/deployment-railway.md](docs/en/deployment-railway.md)                     |
| Deploy to your own infra (K8s, Nomad, Docker, etc.) | [docs/en/deployment-self-host.md](docs/en/deployment-self-host.md)                     |
| Connect to managed cloud DBs (Neon / RDS / Azure) | [docs/en/connecting-cloud-databases.md](docs/en/connecting-cloud-databases.md)           |
| Connect to on-premise DBs (SSH tunnels, VPN)      | [docs/en/connecting-on-premise-databases.md](docs/en/connecting-on-premise-databases.md) |
| Day-to-day operations / runbook                   | [docs/en/devops-runbook.md](docs/en/devops-runbook.md)                                   |
| Troubleshooting                                   | [docs/en/troubleshooting.md](docs/en/troubleshooting.md)                                 |
| Where the project is headed (driver+transport)    | [docs/en/architecture-roadmap.md](docs/en/architecture-roadmap.md)                       |

> The "For DevOps" docs above are part of an in-progress documentation push. Items marked as `STATUS: PROPOSED` describe target architecture, not current behavior — always cross-check with the source if you are about to act on them.

---

## Getting started

### Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker + Docker Compose
- **PostgreSQL 16+** available locally (the `pnpm docker:db` script provides one)

### Install

```bash
git clone https://github.com/Aisaac2205/envault
cd envault
pnpm install
```

### Configure environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Edit both with real values
```

See [docs/en/environment-variables.md](docs/en/environment-variables.md) for the full reference.

> **Better Auth** runs inside the API. Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_ADMIN_EMAIL`, and `BETTER_AUTH_ADMIN_PASSWORD` in `apps/api/.env`.

### Start the local database

```bash
pnpm docker:db
```

### Run in development mode

```bash
pnpm dev
```

API on `http://localhost:3000` · Frontend on `http://localhost:5173`.

### Run everything in Docker

```bash
pnpm docker:dev          # api + web + db with hot reload
pnpm docker:dev:test     # idem + db-test-pg (:5434) + db-test-mysql (:3306)
pnpm docker:prod         # end-to-end production build
```

---

## Scripts

| Command                | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `pnpm dev`             | API + Web in watch/hot-reload mode (native Node.js) |
| `pnpm build`           | Builds every app for production                     |
| `pnpm test`            | Runs every workspace's tests                        |
| `pnpm lint`            | Lints every workspace                               |
| `pnpm typecheck`       | Type-checks without emitting files                  |
| `pnpm docker:dev`      | Full stack in Docker with hot reload                |
| `pnpm docker:dev:test` | Idem + testing DBs (PostgreSQL :5434, MySQL :3306)  |
| `pnpm docker:db`       | Control DB only (when you run api/web natively)     |
| `pnpm docker:prod`     | End-to-end production build                         |

Per workspace:

```bash
pnpm --filter @vaultly-control/api dev
pnpm --filter @vaultly-control/web build
```

---

## Documentation

### Getting started

| Doc                                                 | Content                                             |
| --------------------------------------------------- | --------------------------------------------------- |
| [local-development.md](docs/en/local-development.md)     | Local setup: Node.js vs Docker, commands, debugging       |
| [deployment-railway.md](docs/en/deployment-railway.md)   | Railway walkthrough: services, variables, env setup       |
| [deployment-self-host.md](docs/en/deployment-self-host.md) | Platform-agnostic deployment contract for K8s/Nomad/etc. |

### How it works (domain)

| Doc                                                             | Content                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| [flow-database-management.md](docs/en/flow-database-management.md) | Connections: environments, per-engine permissions, lifecycle |
| [scheduler-architecture.md](docs/en/scheduler-architecture.md)     | Cronjobs, SchedulerRegistry, single-replica trade-off        |
| [security-model.md](docs/en/security-model.md)                     | PROD invariants, audit, authorization (with code references) |

### Operations (DevOps)

| Doc                                                                                      | Content                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [connecting-cloud-databases.md](docs/en/connecting-cloud-databases.md)                   | Managed DB setup: Neon, RDS, Supabase, Azure, GCP    |
| [connecting-on-premise-databases.md](docs/en/connecting-on-premise-databases.md)         | On-prem patterns: self-host, VPN, SSH tunnel         |
| [devops-runbook.md](docs/en/devops-runbook.md)                                           | Pre-prod checklist, monitoring, rotations, incidents |
| [troubleshooting.md](docs/en/troubleshooting.md)                                         | Symptom → cause → fix index                          |

### Technical architecture

| Doc                                                              | Content                                            |
| ---------------------------------------------------------------- | -------------------------------------------------- |
| [architecture.md](docs/en/architecture.md)                       | API modules, web structure, SSE                    |
| [infrastructure.md](docs/en/infrastructure.md)                   | Local Docker Compose, testing credentials          |
| [architecture-roadmap.md](docs/en/architecture-roadmap.md)       | Proposed driver+transport design (NOT implemented) |

### Reference

| Doc                                                       | Content                                   |
| --------------------------------------------------------- | ----------------------------------------- |
| [environment-variables.md](docs/en/environment-variables.md) | Every variable with types and defaults    |
| [database-migrations.md](docs/en/database-migrations.md)     | TypeORM migrations: generate, run, revert |
| [conventions.md](docs/en/conventions.md)                     | Naming, imports, commits, TypeScript      |

---

## License

* **Core Platform (`apps/api`, `apps/web`)**: Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md) — free to use and self-host for any noncommercial purpose. Commercial use, resale, or distribution requires a separate commercial license from the copyright holder.
* **Landing Page & Brand (`apps/landing`, EnVault name/logos)**: **All Rights Reserved**. Strictly proprietary; no reproduction, cloning, or public hosting permitted. See [`apps/landing/LICENSE.md`](apps/landing/LICENSE.md).
