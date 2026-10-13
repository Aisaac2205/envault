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

A healthy run ends with `148 passed` (the number grows as suites are added). Specs for known product defects are written to fail and count as passed; see [Known defects](#known-defects).

> The first `pnpm docker:e2e` builds the images and takes about 3 minutes. Later starts are much faster.

---

## What is covered

| Test type | What it checks | Folder | Status |
|-----------|----------------|--------|--------|
| Smoke | Stack health (`/health`: API, database and storage up), authentication (`GET /connections` is 401 without a session and 200 with one), login page (form renders, protected routes redirect to it, the saved admin session opens the app) | `e2e/tests/api`, `e2e/tests/ui` | Available |
| Black-box API suite | Sign-in (wrong password, unknown email, tampered session cookie, rate-limit guard); authorization (401 without a session, 403 for a non-admin user, on every admin endpoint); connections (create, read, update, delete, validation, the password never returned, `test-raw` against PostgreSQL and MySQL, testing a saved connection); error envelope (400, 401, 403, 404 and the success body); shapes of the read-only jobs, analytics, backups, restores and audit endpoints | `e2e/tests/api` | Available |
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

## Known defects

The suite documents bugs it has found instead of hiding them. Each one has a spec that asserts the **correct** behavior and is marked `test.fail`: Playwright runs it, expects it to fail, and reports it as passed. When the product is fixed the spec starts passing, Playwright reports `Expected to fail, but passed` and fails the run, which is the signal to delete the `test.fail` wrapper and this row.

| Id | Where | What happens today | Spec |
|----|-------|--------------------|------|
| D4 | `GET /api/health` | Answers 404. The dashboard calls this path, but the API serves health outside the `/api` prefix (`/health`, on port 3000 only). | `health.api.spec.ts` |
| D6 | `PATCH /api/connections/:id` | The response contains the decrypted password. Create, read and list correctly omit it. | `connections.api.spec.ts` |
| D7 | `GET /api/<resource>/<id>` with an id that is not a UUID (connections, backups, restores, jobs, audit) | Answers 500 instead of a 4xx, because the id reaches the database unvalidated. | `error-envelope.api.spec.ts` |

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
├── support/               .env.e2e loader, stack readiness check, saved-session path,
│                          fixtures (anonymous, non-admin user, connection factory), envelope helpers
└── tests/
    ├── setup/             signs in once and saves the admin session
    ├── api/               *.api.spec.ts  (HTTP, no browser)
    └── ui/                *.ui.spec.ts   (Chromium)
```

| Project | Runs | Notes |
|---------|------|-------|
| `setup` | `tests/setup` | Waits for the stack, signs in as the seeded admin and saves the session to `e2e/.auth/admin.json`, unless the saved session is still valid. Runs first, automatically. |
| `api` | `tests/api` | Reuses the saved session. |
| `ui-chromium` | `tests/ui` | Reuses the saved session. |

API spec files:

| File | Covers |
|------|--------|
| `health.api.spec.ts` | Stack health; `/api/health` (known defect) |
| `auth.api.spec.ts` | Smoke: `GET /connections` is 401 without a session and 200 with one |
| `sign-in.api.spec.ts` | Wrong password and unknown email, session lookup, tampered cookies, closed self-registration, sign-in rate limit |
| `authorization.api.spec.ts` | 401 without a session and 403 for a non-admin user, one test per admin endpoint |
| `connections.api.spec.ts` | Connection CRUD, validation, no password in responses, `test-raw`, testing a saved connection |
| `error-envelope.api.spec.ts` | The error body for 400, 401, 403 and 404, the success body, ids that are not UUIDs (known defect) |
| `read-contracts.api.spec.ts` | Shapes and zero counts of the jobs, analytics, backups, restores and audit endpoints on a stack without jobs |

### Signing in from a spec

Better Auth allows only 3 sign-ins per 10 seconds per client IP and the limit cannot be configured. Two rules keep the suite under it:

- `setup` is the only place that signs in through the web proxy. It does so at most once per run, and not at all while the saved session is still accepted (it asks `GET /api/auth/get-session?disableCookieCache=true`, which checks the database instead of the cached cookie), so back-to-back runs never reach the limit.
- A spec that needs a sign-in of its own (wrong credentials, the non-admin user, the rate-limit guard) calls `signInOnDirectApi` from `e2e/support/api.ts`. It posts to the API port (`:3000`) with a unique `X-Forwarded-For` header. Behind the proxy every client shares one address, because nginx overwrites that header; the API port trusts it, so each sign-in gets a bucket of its own and never touches the one `setup` uses.

Never sign out the shared admin session: every other spec uses it. The non-admin user is created once per worker through the Better Auth admin plugin and removed when the worker ends.

Generated output (all git-ignored): `e2e/playwright-report/` (HTML report), `e2e/test-results/` (traces and screenshots of failures) and `e2e/.auth/` (the saved session).

---

## Run variants

Pass flags straight after `pnpm test:e2e`, **without** a `--` separator (with it, pnpm forwards the `--` and Playwright ignores the project filter).

```bash
pnpm test:e2e --project=api                      # API specs only
pnpm test:e2e --project=ui-chromium              # browser specs only
pnpm test:e2e tests/api/connections.api.spec.ts  # one file
pnpm test:e2e -g "login"                         # tests whose title matches
pnpm test:e2e --project=api -g "test-raw"        # API tests whose title matches
pnpm test:e2e --project=api --repeat-each=3      # run every API test 3 times to expose flakiness
pnpm test:e2e --project=ui-chromium --headed     # watch the browser
pnpm test:e2e --ui                               # Playwright UI mode
pnpm test:e2e --project=ui-chromium --debug      # step through with the Inspector
pnpm test:e2e:report                             # open the HTML report
```

The `setup` project always runs first, so its test is counted in every run. The report is served at `http://localhost:9323` (press `Ctrl+C` to stop it).

---

## Entry points

| What | Where | Notes |
|------|-------|-------|
| Web app + API proxy | `http://localhost:5173` | The API is under `/api`. |
| API (direct) | `http://localhost:3000` | The only place `/health` exists. Specs that sign in use it (see [Signing in from a spec](#signing-in-from-a-spec)). |
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
| Sign-in fails with HTTP 429 (`Too many requests`) | More than 3 sign-ins in 10 seconds through the proxy. `setup` signs in once at most, so this needs several runs started within seconds while there is no valid saved session (after `pnpm docker:e2e:down`, or with `e2e/.auth` deleted), or a spec that signs in through the proxy. | Wait 10 seconds and run again. In a spec, use `signInOnDirectApi`. |
| Sign-in fails with `INVALID_ORIGIN` | `E2E_BASE_URL` uses `127.0.0.1`. | Use `localhost`. |
| Sign-in fails with `INVALID_EMAIL_OR_PASSWORD`, or the stack boots with surprising values | A variable exported in your shell overrides `.env.e2e` (for Compose and for the tests). | Unset the variable in that shell. |
| `Expected to fail, but passed` on a spec marked `test.fail` | A known defect was fixed. | Delete the `test.fail` wrapper and the row in [Known defects](#known-defects). |
| Accounts named `e2e-user-...@envault.local` remain after an aborted run | The non-admin test user is removed when its worker ends; a killed run skips that. | `pnpm docker:e2e:down` deletes them with the rest of the data. |
| You need a clean slate | Data from a previous run is still in the volumes. | `pnpm docker:e2e:down` deletes the volumes; the next `pnpm docker:e2e` starts empty. |
| Restores fail with `unrecognized configuration parameter "transaction_timeout"` | The source PostgreSQL is older than 17, and the API image's `pg_restore` is version 18. | Keep `E2E_PG_IMAGE` at 17 or newer (default `postgres:18-alpine`). |
