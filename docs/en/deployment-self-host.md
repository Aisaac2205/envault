# Self-Host Deployment Contract

> 🇪🇸 Versión en español: [../es/deployment-self-host.md](../es/deployment-self-host.md)

This is the **platform-agnostic deployment contract** for EnVault Management. It tells you exactly what the app needs to run, regardless of where you run it (Kubernetes, Nomad, Docker Swarm, ECS, `docker run` on a VPS, etc.).

**This doc does NOT include**:
- Kubernetes manifests, Helm charts, or Kustomize bases (write your own from the contract below)
- ArgoCD / Flux / Jenkins X / Spinnaker / Tekton-specific instructions
- Cloud-provider-specific glue (use this together with [connecting-cloud-databases.md](connecting-cloud-databases.md))

If you want a managed PaaS template instead, use [deployment-railway.md](deployment-railway.md).

---

## 1. The two images

EnVault Management ships as two Docker images. Every release publishes both to GitHub Container Registry for `linux/amd64` and `linux/arm64`:

| Image | Published as | Built from | Purpose | Listens on |
|-------|--------------|-----------|---------|------------|
| API | `ghcr.io/aisaac2205/envault-api` | [`apps/api/Dockerfile`](../../apps/api/Dockerfile) | NestJS backend, runs migrations, serves REST + SSE | `3000` (HTTP) |
| Web | `ghcr.io/aisaac2205/envault-web` | [`apps/web/Dockerfile`](../../apps/web/Dockerfile) | nginx serving the built React SPA | `80` (HTTP) |

Each release is tagged `X.Y.Z`, `X.Y` (the newest patch of that minor) and `latest`. Pin `X.Y.Z` in production so an upgrade only happens when you choose it. Both images carry SBOM and provenance attestations.

### Docker Compose with the published images

The root `docker-compose.yml` runs the API, the Web, PostgreSQL and Redis from the published images. It needs only that file and a `.env` next to it, so a full clone is optional.

```bash
cp .env.example .env
# Fill in .env: the secrets and passwords, REDIS_HOST=redis, the R2 storage,
# and ENVAULT_VERSION (for example 1.57.0; `latest` follows every release).
docker compose pull
docker compose up -d
```

The Web answers on `http://localhost:5173` and proxies `/api` to the API, which stays on the internal network. See [environment-variables.md](environment-variables.md#docker-compose-env-at-the-root) for every value.

To upgrade, set `ENVAULT_VERSION` to the new release and run the same two commands, `docker compose pull` and `docker compose up -d`. Migrations run when the new API starts (see [§8](#8-migration-behavior)).

Always run `docker compose pull` before `up`. It fails when an image cannot be pulled (a mistyped version, no network), while `up` alone falls back to building that image from the source in the current folder.

### Building the images yourself

To run the same stack from your checkout instead of the published images, add the build override:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
```

`pnpm docker:prod` does the same in the foreground. The override builds on every `up` and names the images `envault-management-api:local` and `envault-management-web:local`, so a source build never takes the published tags.

To build the images on their own:

```bash
# Local build from monorepo root
docker build -t envault-api:local -f apps/api/Dockerfile .
docker build -t envault-web:local -f apps/web/Dockerfile .
```

Both Dockerfiles expect the monorepo root as the build context because they read `pnpm-workspace.yaml` and `pnpm-lock.yaml`.

The API image installs the PostgreSQL clients 14 to 18 side by side so it can dump and restore any of those server majors. Change the list with the `POSTGRES_CLIENT_VERSIONS` build arg (space-separated), for example `docker build --build-arg POSTGRES_CLIENT_VERSIONS="16 17 18" -f apps/api/Dockerfile .`; for the Compose build, add it under `build.args` of the `api` service in `docker-compose.yml`.

### Individual Container Deployment

If you prefer to deploy the API, Web, and infrastructure services on separate hosts or standalone containers without Docker Compose:

```bash
# The release to run, for example the newest one on the GitHub Releases page.
ENVAULT_VERSION=X.Y.Z

# 1. Redis Container (with AOF persistence and mandatory authentication)
docker run -d \
  --name envault-redis \
  --restart unless-stopped \
  -v redis_data:/data \
  redis:7-alpine redis-server --appendonly yes --maxmemory-policy noeviction --requirepass "your-secure-password"

# 2. API Container (on backend host)
docker run -d \
  --name envault-api \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env.api \
  "ghcr.io/aisaac2205/envault-api:${ENVAULT_VERSION}"

# 3. Web Container (on frontend host)
docker run -d \
  --name envault-web \
  --restart unless-stopped \
  -p 80:80 \
  -e API_UPSTREAM=api.internal.corp:3000 \
  -e CSP_HEADER_NAME=Content-Security-Policy \
  "ghcr.io/aisaac2205/envault-web:${ENVAULT_VERSION}"
```

`--maxmemory-policy noeviction` is required so Redis rejects writes instead of silently evicting BullMQ queue keys under memory pressure (see [BullMQ: going to production](https://docs.bullmq.io/guide/going-to-production)). A managed Redis instance (for example, on Railway) is provisioned outside `docker-compose.yml`, so this policy must be set through that provider's own configuration instead.

---

## 2. Environment Variables: The Contract

Full reference in [environment-variables.md](environment-variables.md). The table below specifies the mandatory configuration contract.

### API (runtime)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Control database connection string (must be PostgreSQL 16+) |
| `ENCRYPTION_KEY` | yes | 64-character hexadecimal key (32 bytes) for AES-256-GCM credential encryption |
| `NODE_ENV` | yes | `production` in any deployed environment |
| `PORT` | no (default `3000`) | HTTP listen port |
| `CORS_ORIGIN` | yes in production | Exact frontend domain, no wildcards allowed |
| `BETTER_AUTH_SECRET` | yes | Secret for signing session cookies (minimum 32 random characters) |
| `BETTER_AUTH_URL` | yes | Public base URL of the API |
| `BETTER_AUTH_ADMIN_EMAIL` | yes | Seed administrator email (used on initial boot) |
| `BETTER_AUTH_ADMIN_PASSWORD` | yes | Seed administrator password |
| `REDIS_HOST` | yes in production unless `REDIS_URL` is set | Redis host (for example `redis` in Docker Compose). Defaults to `localhost` outside production; in production the API refuses to boot without it or `REDIS_URL` |
| `REDIS_PORT` | no (default `6379`) | Redis TCP port |
| `REDIS_PASSWORD` | yes in production | Password to authenticate with Redis via requirepass |
| `REDIS_URL` | optional | Full Redis URL (`redis://...` or `rediss://...`). Takes precedence when provided |
| `REDIS_TLS` | no (default `false`) | Enables TLS when connecting to an external managed Redis cluster |
| `R2_ACCOUNT_ID` | yes in production | Cloudflare account identifier (32-character hexadecimal) |
| `R2_ACCESS_KEY_ID` | yes in production | Generated from Cloudflare R2 API Tokens |
| `R2_SECRET_ACCESS_KEY` | yes in production | Generated from Cloudflare R2 API Tokens |
| `R2_BUCKET_NAME` | yes in production | Cloudflare R2 bucket designated for backups |
| `BACKUP_TIMEOUT_MS` | no (default `1800000`) | Maximum timeout in milliseconds for database dump execution (30 minutes) |
| `RESTORE_TIMEOUT_MS` | no (default `1800000`) | Time limit in milliseconds for a whole restore, counted from when it starts running: the download from object storage and the `pg_restore` / `mysql` CLI together. A restore that goes past it fails and the queue moves on. The final swap of a MySQL restore is never cut in half: it finishes or rolls back, and a swap that finishes late still counts as a completed restore. Raise it if your restores legitimately take longer |
| `RESTORE_LOCK_WAIT_TIMEOUT_MS` | no (default `30000`) | Milliseconds a restore waits for each lock another session holds on the target's tables before failing and leaving the target unchanged: a PostgreSQL restore cancels the `pg_restore` statement that has waited this long, which rolls the restore back, and a MySQL restore applies it to each step of the final swap. It applies per lock attempt, and the target application's queries on those tables wait meanwhile |

> **Redis network**: keep Redis on a private network (the Docker network, or Railway private networking). If it must cross a public network, connect with a `rediss://` `REDIS_URL` or set `REDIS_TLS=true`.

> **Redis network**: keep Redis on a private network (the Docker network, or Railway private networking). If it must cross a public network, connect with a `rediss://` `REDIS_URL` or set `REDIS_TLS=true`.

### Web (runtime)

The published Web image holds no per-install value, so one image serves every install. The SPA calls `/api` on its own origin, and nginx proxies that path to `API_UPSTREAM`, which it reads when the container starts. **No `.env` file goes into the image.**

| Variable | Required | Notes |
|----------|----------|-------|
| `API_UPSTREAM` | no (default `api:3000`) | `host:port` that nginx proxies `/api/*` to |
| `CSP_HEADER_NAME` | no (default `Content-Security-Policy`) | Set `Content-Security-Policy-Report-Only` only to debug a violation |
| `CLIENT_IP_MODE` | no (default `auto`) | `direct` uses the TCP peer address, `railway` trusts the `X-Real-IP` set by Railway's edge; `auto` picks `railway` when `RAILWAY_ENVIRONMENT_ID` is set |

> `VITE_API_URL` is the only build-time variable. The published image is built with it empty, and its CSP (`connect-src 'self'`) only allows calls to its own origin, so serve the Web and the API from one origin through the Web container. A split origin needs your own build with `VITE_API_URL` set to the API's bare origin, plus a CSP that allows it.

> Auth is handled entirely by the API via Better Auth. The Web does not need any auth-specific env vars — sessions are cookie-based and the browser handles them automatically.

---

## 3. Health endpoints and probes

| Endpoint | Path | Auth | Returns |
|----------|------|------|---------|
| API liveness/readiness | `GET /health` | None (public) | `200` if healthy |
| Web liveness | `GET /` | None | `200` (nginx serves index.html) |

### Recommended probe configuration

| Probe | API | Web |
|-------|-----|-----|
| Liveness path | `/health` | `/` |
| Readiness path | `/health` | `/` |
| Initial delay | 15s (allow migrations to run) | 5s |
| Period | 10s | 10s |
| Timeout | 3s | 2s |
| Failure threshold | 3 | 3 |

The **15-second initial delay on the API** is important: on first boot, TypeORM runs migrations against the control DB before the HTTP server is fully ready. If your probe runs too soon, the pod gets killed before migrations finish.

---

## 4. Resource sizing

Honest baseline numbers. **Validate against your own workload** — they are starting points, not commitments.

| Container | CPU request | CPU limit | Memory request | Memory limit |
|-----------|------------|-----------|----------------|--------------|
| API | 100m | 500m | 256 MiB | 512 MiB |
| Web (nginx) | 25m | 100m | 32 MiB | 128 MiB |
| Control DB (Postgres 16) | 250m | 1000m | 512 MiB | 2 GiB |
| Redis (BullMQ) | 50m | 200m | 64 MiB | 256 MiB |

**Scaling drivers**:
- API memory grows with **dump size during streaming**. `pg_dump` of a 50GB DB does not load it all into memory (streaming), but parts of the multipart R2 upload do buffer. If you back up large DBs (>20GB), bump API memory to 1 GiB.
- API CPU spikes during dump compression and restore. Brief spikes are fine; sustained pressure means you're undersized.
- Web is essentially free (nginx serving static files). If you have thousands of concurrent users, that's another conversation, but for an internal DevOps tool, the defaults are generous.

---

## 5. Storage

| Container | Persistent volume needed? | Why |
|-----------|---------------------------|-----|
| API | **No** | Stateless. Dumps stream to R2, nothing on local disk. |
| Web | **No** | Stateless. Just serves static files. |
| Control DB | **Yes** | This is the source of truth (back it up too, see [devops-runbook.md §5](devops-runbook.md#5-backup-of-the-control-database-itself)). |
| Redis | **Yes** | AOF persistence for BullMQ queues and job state. |

For the control DB, use the volume strategy of your platform: PVC on K8s, EBS on EC2, local SSD with daily snapshots on VPS, etc. **Minimum 20 GiB** for the control DB volume; grows slowly (audit logs are the main driver).

---

## 6. Networking

### Ingress

| Service | Ingress needed | Protocol | Notes |
|---------|----------------|----------|-------|
| Web | yes | HTTPS (terminate at ingress) | This is the user-facing entry |
| API | yes | HTTPS | The Web hits it; if Web and API are on the same domain, route `/api/*` to API |
| Control DB | no | — | Internal only, never expose publicly |

Recommended: put both behind the same hostname (`envault.example.com` for Web, `envault.example.com/api` for API) to avoid CORS gymnastics. If you split (`app.` and `api.`), set `CORS_ORIGIN` on the API to the Web's exact domain.

### Egress

The API needs outbound network access to:

- **Cloudflare R2** — `*.r2.cloudflarestorage.com` (HTTPS, port 443)
- **Every managed/on-prem DB** you register as a connection (TCP, varies — typically 5432/3306)

Better Auth runs inside the API process and connects to the same PostgreSQL instance — no additional egress is needed for auth. The Web container has **no outbound network needs** — it just serves static files.

---

## 7. Scaling constraints — READ THIS

> ⚠️ **The API is single-replica only, today.**

The cronjob scheduler runs in-process (`@nestjs/schedule`). If you deploy the API with `replicas: 2` (or more), **every replica fires every scheduled backup**, producing duplicate dumps and wasted R2 storage.

| Service | Max replicas | Min replicas | Why |
|---------|-------------|--------------|-----|
| API | **1** | 1 | In-process scheduler |
| Web | unlimited | 1 | Pure nginx, fully stateless |
| Control DB | 1 primary (+ replicas if you want HA reads, but not required) | 1 | Standard Postgres |

For HA on the API today: configure a single replica with `RollingUpdate` strategy (`maxSurge: 1, maxUnavailable: 0`). On K8s this means brief unavailability during deploys; if that's unacceptable, **the BullMQ + Redis migration in [architecture-roadmap.md §4](architecture-roadmap.md#phase-5--operational-hardening-independent-of-driver-work) is the unblocker**, not multi-replica today.

---

## 8. Migration behavior

The API runs migrations on startup with `migrationsRun: true`. Implications:

- **No init container needed**. The API container handles migrations itself.
- **First boot against an empty DB will fail** until [`InitialSchema` migration](database-migrations.md#3-the-solution-generate-an-initialschema-migration) is generated.
- **Rolling deploys with migrations**: TypeORM acquires an advisory lock on the `migrations` table, so concurrent startups are safe — but since you only run one replica, this is moot.
- **Rollbacks are non-trivial**. A migration that adds a column is forward-compatible (the old image ignores the new column). One that drops a column or changes a type is not. Plan migrations to be backward-compatible for at least one release.

---

## 9. Minimum viable Kubernetes example (illustrative, NOT a template)

> **Better Auth runs inside the API — no external auth service needed.** Users and sessions are stored in the same PostgreSQL instance. No Keycloak, no separate auth deployment.

Below is the **smallest possible** set of manifests to run EnVault Management on K8s. It is intentionally minimal and **does not include** ingress, TLS, secrets management, persistent volumes, or any production hardening. Treat it as a starting point to verify the contract, not as something to deploy as-is.

```yaml
# api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: envault-api
spec:
  replicas: 1  # MUST be 1 — see §7
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: envault-api
  template:
    metadata:
      labels:
        app: envault-api
    spec:
      containers:
        - name: api
          image: ghcr.io/aisaac2205/envault-api:X.Y.Z  # pin a release
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: envault-api-secrets
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
---
# api-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: envault-api
spec:
  selector:
    app: envault-api
  ports:
    - port: 3000
      targetPort: 3000
```

The Web is structurally identical — swap `3000` for `80`, point env vars at the API service, done. You handle ingress, TLS, secrets, and persistence with whatever your team already uses.

---

## 11. Cross-references

- Env vars in detail: [environment-variables.md](environment-variables.md)
- Operational concerns (monitoring, rotations, incident response): [devops-runbook.md](devops-runbook.md)
- DB connectivity from inside the cluster: [connecting-cloud-databases.md](connecting-cloud-databases.md) and [connecting-on-premise-databases.md](connecting-on-premise-databases.md)
- Where the project is heading (multi-replica scheduler, native SSL): [architecture-roadmap.md](architecture-roadmap.md)
- Common failure modes: [troubleshooting.md](troubleshooting.md)
