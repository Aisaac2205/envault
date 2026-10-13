# E2E Testing — EnVault Management

> 🇪🇸 Versión en español: [../es/e2e-testing.md](../es/e2e-testing.md)

End-to-end (E2E) tests that exercise EnVault from the outside, the way a user or an API client would, against a production-like Docker stack. They use [Playwright](https://playwright.dev) and live in the `e2e/` workspace package (`@vaultly-control/e2e`).

This is **black-box** testing: the suite only talks HTTP and drives a real browser. The **white-box** unit tests stay where they were, in Jest (`apps/api`) and Vitest (`apps/web`), and run with `pnpm test`. E2E specs are never collected by `pnpm test`; they have their own command, `pnpm test:e2e`.

---

## Quick path

From the repository root:

| # | Command | What it does |
|---|---------|--------------|
| 1 | `cp .env.e2e.example .env.e2e` | Creates your local (git-ignored) config. Once. |
| 2 | `pnpm install` | Installs the workspace, including Playwright. |
| 3 | `pnpm e2e:install` | Downloads the Chromium browser Playwright drives. Once. |
| 4 | `pnpm docker:e2e` | Builds and starts the test stack, and returns when it is healthy. |
| 5 | `pnpm test:e2e` | Runs the suite. |
| 6 | `pnpm docker:e2e:down` | Stops the stack and deletes its data. |

A healthy run ends with `7 passed`.

> The first `pnpm docker:e2e` builds the images and takes about 3 minutes. Later starts are much faster.

---

## What is covered

| Test type | What it checks | Folder | Status |
|-----------|----------------|--------|--------|
| Smoke | Stack health (`/health`: API, database and storage up), authentication (`GET /connections` is 401 without a session and 200 with one), login page (form renders, protected routes redirect to it, the saved admin session opens the app) | `e2e/tests/api`, `e2e/tests/ui` | Available |
| Black-box API suite | Auth, connections, validation, role guard, error envelope | `e2e/tests/api` | Planned |
| Black-box UI suite | Login, connections and dashboard flows in the browser | `e2e/tests/ui` | Planned |
| Backup / restore pipeline | Functional backup and restore of PostgreSQL and MySQL through the real queue and object storage | To be defined | Planned |
| Performance | Duration, queue wait and throughput of dumps and restores | To be defined | Planned |

**Not covered (by design):**

- White-box coverage of the code: that is Jest and Vitest.
- Load or stress tests with many concurrent users.
- Network latency to the real Cloudflare R2: the stack uses MinIO, a local S3-compatible store, so timings exclude that hop.
- CI integration: the suite runs on a developer machine for now.

Every change that adds or changes a suite must update this table.

---

## Prerequisites

- Node.js >= 22 and pnpm >= 10
- Docker Desktop with Compose (verified with Docker 29.8.2 and Compose v5.5.1)
- These host ports free:

| Port | Used by |
|------|---------|
| 5173 | Web app and API proxy. **Shared with the dev and prod compose files: stop those stacks first** (see [local-development.md](local-development.md)). |
| 3000 | API, published directly |
| 5435 | Source PostgreSQL |
| 3307 | Source MySQL |
| 9000 / 9001 | MinIO (S3 API / console) |

---

## How the suite is organised

```
e2e/
├── playwright.config.ts   projects: setup, api, ui-chromium
├── support/               .env.e2e loader, stack readiness check, saved-session path
└── tests/
    ├── setup/             signs in once and saves the admin session
    ├── api/               *.api.spec.ts  (HTTP, no browser)
    └── ui/                *.ui.spec.ts   (Chromium)
```

| Project | Runs | Notes |
|---------|------|-------|
| `setup` | `tests/setup` | Waits for the stack, signs in as the seeded admin and saves the session to `e2e/.auth/admin.json`. Runs first, automatically. |
| `api` | `tests/api` | Reuses the saved session. |
| `ui-chromium` | `tests/ui` | Reuses the saved session. |

Specs reuse the saved session instead of signing in: Better Auth allows only 3 sign-ins per 10 seconds per IP and the limit cannot be configured. **Do not add sign-ins to specs.**

Generated output (all git-ignored): `e2e/playwright-report/` (HTML report), `e2e/test-results/` (traces and screenshots of failures) and `e2e/.auth/` (the saved session).

---

## Run variants

Pass flags straight after `pnpm test:e2e`, **without** a `--` separator (with it, pnpm forwards the `--` and Playwright ignores the project filter).

```bash
pnpm test:e2e --project=api                    # API specs only
pnpm test:e2e --project=ui-chromium            # browser specs only
pnpm test:e2e tests/api/health.api.spec.ts     # one file
pnpm test:e2e -g "login"                       # tests whose title matches
pnpm test:e2e --project=ui-chromium --headed   # watch the browser
pnpm test:e2e --ui                             # Playwright UI mode
pnpm test:e2e --project=ui-chromium --debug    # step through with the Inspector
pnpm test:e2e:report                           # open the HTML report
```

The `setup` project always runs first, so its test is counted in every run. The report is served at `http://localhost:9323` (press `Ctrl+C` to stop it).

---

## Entry points

| What | Where | Notes |
|------|-------|-------|
| Web app + API proxy | `http://localhost:5173` | The API is under `/api`. |
| API (direct) | `http://localhost:3000` | The only place `/health` exists. |
| MinIO (S3) | `http://localhost:9000` | Console on `http://localhost:9001`. Sign in with `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` from `.env.e2e`. |
| Source PostgreSQL | `localhost:5435` | Database `testdb`, user `test_user`, password `test_pass123`. |
| Source MySQL | `localhost:3307` | Database `testdb`, user `test_user`, password `test_pass123`. |

Always use the hostname `localhost`, never `127.0.0.1`: the session cookie is `Secure`, and browsers and Playwright only send it over plain http to `localhost`.

---

## Environment variables the tests read

The tests load the repository-root `.env.e2e`, the same file that configures the stack. A variable already exported in your shell wins over the file.

| Variable | Default | Used for |
|----------|---------|----------|
| `BETTER_AUTH_ADMIN_EMAIL` | from `.env.e2e` | Admin account the stack seeds; the tests sign in with it. |
| `BETTER_AUTH_ADMIN_PASSWORD` | from `.env.e2e` | Password of that admin. |
| `E2E_BASE_URL` | `http://localhost:5173` | Web app and API proxy. |
| `E2E_DIRECT_API_URL` | `http://localhost:3000` | Direct API. Change it if you override `E2E_API_PORT`. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `pnpm docker:e2e` fails with `Bind for 0.0.0.0:5173 failed: port is already allocated` | Another stack (dev or prod compose, or another app) holds the port. | Stop it and run again. |
| `The E2E stack is not ready: ... (last result: ECONNREFUSED)` | The tests ran while the stack is down; they retry for 30 seconds before failing. | Run `pnpm docker:e2e`, then the tests again. |
| `couldn't find env file: ...\.env.e2e` or `E2E configuration is incomplete: ... .env.e2e does not exist` | `.env.e2e` is missing. | `cp .env.e2e.example .env.e2e` |
| Sign-in fails with HTTP 429 (`Too many requests`) | More than 3 sign-ins in 10 seconds. Each run signs in once, so this happens when you start runs back to back. | Wait 10 seconds and run again. |
| Sign-in fails with `INVALID_ORIGIN` | `E2E_BASE_URL` uses `127.0.0.1`. | Use `localhost`. |
| Sign-in fails with `INVALID_EMAIL_OR_PASSWORD`, or the stack boots with surprising values | A variable exported in your shell overrides `.env.e2e` (for Compose and for the tests). | Unset the variable in that shell. |
| You need a clean slate | Data from a previous run is still in the volumes. | `pnpm docker:e2e:down` deletes the volumes; the next `pnpm docker:e2e` starts empty. |
| Restores fail with `unrecognized configuration parameter "transaction_timeout"` | The source PostgreSQL is older than 17, and the API image's `pg_restore` is version 18. | Keep `E2E_PG_IMAGE` at 17 or newer (default `postgres:18-alpine`). |
