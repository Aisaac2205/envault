# Architecture — EnVault Management

> 🇪🇸 Versión en español: [../es/architecture.md](../es/architecture.md)

## API — NestJS Modular Monolith

**Path:** `apps/api` | **Port:** `3000`

The API follows a **Modular Monolith** pattern: a single NestJS process split into well-bounded domain modules. Each module is self-contained (its own controller, service, DTOs and entities) and gets imported into `AppModule`. This layout makes it straightforward to extract a module into a microservice later without rewriting the internal interfaces.

### Domain modules (`src/modules/`)

| Module | Path | Responsibility |
|--------|------|----------------|
| `connections` | `src/modules/connections/` | CRUD for database connections (host, port, credentials, engine) |
| `backup` | `src/modules/backup/` | On-demand dump execution and streaming to Cloudflare R2 |
| `restore` | `src/modules/restore/` | Download a dump from R2 and restore it into the target database |
| `queue` | `src/modules/queue/` | Redis client and BullMQ asynchronous queue setup |
| `jobs` | `src/modules/jobs/` | Backup job lifecycle management |
| `cronjobs` | `src/modules/cronjobs/` | Scheduled backup definitions |
| `audit` | `src/modules/audit/` | Immutable log of every executed operation |

### Cross-cutting infrastructure

```
apps/api/src/
│
├── auth/                        # Authentication (Better Auth, cookie sessions)
│   ├── auth.config.ts           # Better Auth instance
│   ├── auth.controller.ts       # /api/auth/* catch-all handler
│   ├── auth.guard.ts            # BetterAuthGuard
│   ├── decorators/              # @CurrentUser, etc.
│   └── seeds/                   # Default admin seed on first boot
│
├── common/
│   ├── guards/                  # Auth guards
│   ├── interceptors/            # Logging, response transformation
│   ├── filters/                 # Centralized exception filters
│   └── decorators/              # @CurrentUser, @Roles, etc.
│
├── config/
│   ├── database.config.ts       # TypeORM + PostgreSQL
│   ├── r2.config.ts             # S3 client for Cloudflare R2
│   └── env.validation.ts        # Env validation with Joi
│
├── connections/                 # Seed script for initial connections
│
├── database/
│   ├── entities/                # TypeORM entities
│   ├── enums/                   # Domain enumerations
│   └── migrations/              # TypeORM migrations
│
├── health/
│   ├── health.controller.ts     # GET /health — liveness/readiness
│   └── health.module.ts
│
├── modules/                     # Domain modules (see table above)
│   ├── backup/
│   ├── restore/
│   ├── connections/
│   ├── jobs/
│   ├── cronjobs/
│   └── audit/
│
├── shared/
│   └── sse/                     # Server-Sent Events gateway
│
├── app.module.ts
└── main.ts
```

---

## Web — React + Vite Vertical Slice

**Path:** `apps/web` | **Dev port:** `5173` | **Production port:** `80` (nginx)

The frontend follows the **Vertical Slice** architecture: every screen (feature) is a self-contained unit. There is no global `components/` folder — only `shared/` for elements that are genuinely reusable across features.

### Features (`src/features/`)

| Feature | Path | Description |
|---------|------|-------------|
| `dashboard` | `src/features/dashboard/` | Overview: latest job run, R2 storage usage, active connections |
| `dumps` | `src/features/dumps/` | List, download and manually trigger backups |
| `restore` | `src/features/restore/` | Pick a dump and restore it into a target connection |
| `cronjobs` | `src/features/cronjobs/` | Create, toggle and edit automatic backup schedules |
| `connections` | `src/features/connections/` | Connection management (with connectivity test) |
| `audit` | `src/features/audit/` | Audit log with filters by date, user and operation type |

Each feature has this internal layout:

```
feature/
├── index.tsx          # Page component (lazy-loadable, default export)
├── types.ts           # Feature-local types (not shared)
├── components/        # Components exclusive to this screen
└── hooks/             # Data hooks and local logic
```

### Shared (`src/shared/`)

Truly reusable elements across features:

```
src/shared/
├── assets/         # Images, icons, static resources
├── components/     # Reusable UI components (Layout, Sidebar, etc.)
├── hooks/          # Generic hooks (useDebounce, usePagination, useSSE…)
├── lib/            # Pure utilities, HTTP client (axios), helpers
├── providers/      # Context providers (auth, theme, etc.)
├── styles/         # Global styles, design tokens, CSS reset
└── ui/             # Base UI primitives (buttons, inputs, badges…)
```

---

## Real-Time Updates with Server-Sent Events (SSE)

The API emits events from `src/shared/sse/` that the frontend consumes via the `useSSE` hook (`shared/hooks/`). This lets the UI track backup, restore and job state in real time without polling.

The hook handles:
- Initial connection and automatic reconnection on drops
- Dispatch of typed events to the matching features
- Cleanup on component unmount

---

## Asynchronous Queues and Background Processing (Redis + BullMQ)

EnVault processes compute-intensive database dumps and network transfers through BullMQ and Redis 7, fully decoupling execution from the HTTP request lifecycle.

### 1. Decoupled Job Lifecycle
Backup creation and database restore requests return immediately with an HTTP 202 Accepted status code. The API records the job in a PENDING state, publishes the payload to Redis, and delegates processing to dedicated workers. Clients observe real-time progress via Server-Sent Events.

### 2. Connection-Level Concurrency Isolation
Every job inspects active tasks for the target database. When an existing job is in a PENDING or RUNNING state for the same database, the API rejects the request with an HTTP 409 Conflict error to prevent lock contention and resource exhaustion.

### 3. Direct Multipart Streaming to Cloudflare R2
Native dump streams pipe directly into Cloudflare R2 without staging intermediate files on local container storage. The stream processor divides data into 32MB chunks with four concurrent part uploads. If an error occurs or a user cancels the task, EnVault issues an immediate abort signal to delete incomplete parts in object storage.

### 4. Two-Stage Coordinated Purge
The purge process operates in two coordinated stages to prevent orphan files in cloud storage and inconsistent entries in the control database. First, EnVault issues the physical deletion command to the object storage bucket. Once the cloud provider confirms remote object removal, the platform purges the corresponding job record from the control database.

### 5. Non-Destructive Dry-Run Simulation
To validate retention policies before executing irreversible deletions, EnVault supports dry-run simulation mode. This operation computes configured retention rules and reports the exact list of candidate dumps, their IDs, and the total storage volume to be reclaimed, without modifying or deleting any remote objects.

### 6. Storage Capacity and Cloudflare R2 Limits
Cloudflare R2 integration provides a generous free tier of ten gigabytes of monthly storage at zero cost with zero egress bandwidth fees. In addition, it includes one million Class A write operations and ten million Class B read operations every month without charge.

The maximum individual object size supported by Cloudflare R2 is five terabytes. EnVault streams dumps using 32MB multipart parts, enabling single continuous archive streams of up to 320 GB without exceeding the ten thousand part ceiling of the S3 protocol.

For restores requiring local decompression and processing, the staging service validates that local storage maintains a safety margin of twenty percent above the dump size plus a minimum floor of 50 MB, blocking execution early if available disk space is insufficient to prevent disk exhaustion errors (ENOSPC).


