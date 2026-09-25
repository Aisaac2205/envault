# Architecture — EnVault Management

> 🇪🇸 Versión en español: [../es/architecture.md](../es/architecture.md)

## API — NestJS Modular Monolith

**Path:** `apps/api` | **Port:** `3000`

The API follows a **Modular Monolith** pattern: a single NestJS process split into well-bounded domain modules. Each module is self-contained (its own controller, service, DTOs and entities) and gets imported into `AppModule`. This layout makes it straightforward to extract a module into a microservice later without rewriting the internal interfaces.

### Domain modules (`src/modules/`)

| Module | Path | Responsibility |
|--------|------|----------------|
| `connections` | `src/modules/connections/` | CRUD for database connections (host, port, credentials, engine) |
| `backup` | `src/modules/backup/` | On-demand dump execution and storage in R2 |
| `restore` | `src/modules/restore/` | Download a dump from R2 and restore it into the target database |
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

## Real-time — SSE (Server-Sent Events)

The API emits events from `src/shared/sse/` that the frontend consumes via the `useSSE` hook (`shared/hooks/`). This lets the UI track backup, restore and job state in real time without polling.

The hook handles:
- Initial connection and automatic reconnection on drops
- Dispatch of typed events to the matching features
- Cleanup on component unmount
