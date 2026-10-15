# E2E Testing — EnVault Management

> 🇪🇸 Versión en español: [../es/e2e-testing.md](../es/e2e-testing.md)

End-to-end (E2E) tests that exercise EnVault from the outside, the way a user or an API client would, against a production-like Docker stack. They use [Playwright](https://playwright.dev) and live in the `e2e/` workspace package (`@vaultly-control/e2e`).

This is **black-box** testing: the suite only talks HTTP and drives a real browser. The **white-box** unit tests stay where they were, in Jest (`apps/api`) and Vitest (`apps/web`, `apps/landing`), and run with `pnpm test`; their coverage is measured with `pnpm test:coverage` (see [testing-coverage.md](testing-coverage.md)). E2E specs are never collected by `pnpm test`; they have their own command, `pnpm test:e2e`. The performance suite is a separate benchmark with its own command, `pnpm test:e2e:perf`, and is never part of `pnpm test:e2e` either.

The results of this suite, its reliability evidence and the defects it found are summarised in the [QA report](qa-report.md).

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

A healthy run ends with `255 passed` and `1 skipped` (the numbers grow as suites are added). Specs for known product defects are written to fail and count as passed, and the one skipped test only runs against an old PostgreSQL; see [Known defects](#known-defects) and [Backup and restore tests](#backup-and-restore-tests).

> The first `pnpm docker:e2e` builds the images and takes about 3 minutes. Later starts are much faster.

---

## What is covered

| Test type | What it checks | Folder | Status |
|-----------|----------------|--------|--------|
| Smoke | Stack health (`/health`: API, database and storage up), authentication (`GET /connections` is 401 without a session and 200 with one), login page (form renders, protected routes redirect to it, the saved admin session opens the app) | `e2e/tests/api`, `e2e/tests/ui` | Available |
| Black-box API suite | Sign-in (wrong password, unknown email, tampered session cookie, rate-limit guard); authorization (401 without a session, 403 for a non-admin user, on every admin endpoint); connections (create, read, update, which keeps the engine unless the request names one, delete, validation, the password never returned, `test-raw` against PostgreSQL and MySQL, testing a saved connection); cronjobs (create, rename and new expression that keep an active cronjob scheduled with its next run, a paused one that stays paused, pause and resume, 404); error envelope (400, 401, 403, 404 and the success body); shapes of the read-only jobs, analytics, backups, restores and audit endpoints | `e2e/tests/api` | Available |
| Black-box UI suite | Login (form, browser validation, wrong password, successful sign-in that survives a reload, password toggle, logout of its own session); navigation and roles (every sidebar section opens its page, a regular user sees and reaches only what is not admin-only); connections (empty state, create PostgreSQL and MySQL through the form, form validation, test connection from the form and from a row, filter, edit, delete with confirmation, the password never shown); dashboard (title, KPI cards, panels, only successful requests, an empty system); unknown addresses | `e2e/tests/ui` | Available |
| Backup / restore pipeline | Real backups and restores of PostgreSQL and MySQL through the API, the queue, `pg_dump` / `mysqldump`, object storage and `pg_restore` / `mysql`, on databases the tests seed themselves: job fields, the dump downloaded through its signed URL (size and SHA-256), the manifest, restore into `dev` and `qa` with row counts and a data checksum equal to the source, a dry run that changes nothing, restore into `prod` refused, malformed and unknown requests, a pending backup returned to repeated requests, failed backups (error message, no object), job lists, history and analytics; one UI journey that starts a backup from the Dumps page | `e2e/tests/pipeline`, `e2e/tests/ui` | Available |
| Performance | Throughput of backup and restore per engine and dataset size (about 10 MiB to 1 GiB), BullMQ concurrency (K simultaneous backups, one against two restores), cold-load timings of the screens in Chromium, API latency; results as JSON, CSV and Markdown | `e2e/tests/perf` | Available (opt-in, see [Performance suite](#performance-suite)) |

**Not covered (by design):**

- White-box coverage of the code: that is Jest and Vitest, documented in [testing-coverage.md](testing-coverage.md).
- Load or stress tests with many concurrent users.
- Network latency to the real Cloudflare R2: the stack uses MinIO, a local S3-compatible store, so timings exclude that hop.
- Visual snapshots, accessibility audits and browsers other than Chromium.
- CI integration: the suite runs on a developer machine for now.

Every change that adds or changes a suite must update this table.

---

## Known defects

The suite documents bugs it has found instead of hiding them. Each one has a spec that asserts the **correct** behavior and is marked `test.fail`: Playwright runs it, expects it to fail, and reports it as passed. When the product is fixed the spec starts passing, Playwright reports `Expected to fail, but passed` and fails the run, which is the signal to delete the `test.fail` wrapper and this row. D1 is the exception: its spec describes the failure itself and only runs against an old PostgreSQL, so it passes today and starts failing when the defect is fixed; delete it then.

| Id | Where | What happens today | Spec |
|----|-------|--------------------|------|
| D1 | Restore into a PostgreSQL older than 17 | The API image's `pg_restore` is version 18 and aborts on `SET transaction_timeout`, so every restore fails. See [PostgreSQL older than 17 (D1)](#postgresql-older-than-17-d1). | `restore.pipeline.spec.ts` |
| D8 | `/`, `/restore`, `/cronjobs` and `/audit` as a regular user (role `user`) | The sidebar offers these screens, but every API endpoint behind them is admin-only and answers 403, so the user sees zeros, empty tables or a loading state that never ends, with no message. | `navigation.ui.spec.ts` |

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
├── playwright.config.ts   projects: setup, api, pipeline, ui-chromium
├── playwright.perf.config.ts   projects: perf-unit, setup, perf (the benchmark; never part of pnpm test:e2e)
├── support/               .env.e2e loader, stack readiness check, saved-session path,
│                          fixtures (anonymous, admin API client, non-admin user, connection
│                          factory and cleanup), envelope helpers, canned API answers (mock-api.ts),
│                          rate-limit routing for the browser (browser.ts), page objects (pages/),
│                          pipeline: source databases and seed data (databases.ts, seed-data.ts),
│                          job polling (jobs.ts), object storage (storage.ts), fixtures (pipeline-fixtures.ts),
│                          performance: settings, datasets, timings, statistics, report and reporter (perf/)
└── tests/
    ├── setup/             signs in once and saves the admin session
    ├── api/               *.api.spec.ts       (HTTP, no browser)
    ├── pipeline/          *.pipeline.spec.ts  (HTTP, real backup and restore jobs)
    ├── perf/              *.perf.spec.ts (the benchmark), *.unit.spec.ts (its helpers, no stack)
    └── ui/                *.ui.spec.ts        (Chromium)
```

| Project | Runs | Notes |
|---------|------|-------|
| `setup` | `tests/setup` | Waits for the stack, signs in as the seeded admin and saves the session to `e2e/.auth/admin.json`, unless the saved session is still valid. Runs first, automatically. |
| `api` | `tests/api` | Reuses the saved session. |
| `pipeline` | `tests/pipeline` | Reuses the saved session. Gives each test 120 s because jobs are asynchronous. Seeds source databases from the host (see [Backup and restore tests](#backup-and-restore-tests)). Part of the default run. |
| `ui-chromium` | `tests/ui` | Reuses the saved session. Its auth calls use a rate-limit bucket of their own (see [Browser specs and the rate limit](#browser-specs-and-the-rate-limit)). |
| `perf-unit` | `tests/perf` (`*.unit.spec.ts`) | Only in `playwright.perf.config.ts`. Unit tests of the statistics helpers; no stack needed. `setup` depends on it there, so a broken helper stops a benchmark run before it starts. |
| `perf` | `tests/perf` (`*.perf.spec.ts`) | Only in `playwright.perf.config.ts`. The benchmark, one worker and one test at a time. See [Performance suite](#performance-suite). |

Generated output (all git-ignored): `e2e/playwright-report/` (HTML report), `e2e/test-results/` (traces and screenshots of failures) and `e2e/.auth/` (the saved session); the performance suite adds `e2e/perf-results/` (one folder per run) and `e2e/test-results-perf/`.

API spec files:

| File | Covers |
|------|--------|
| `health.api.spec.ts` | Stack health on the API port; `/api/health` and the web proxy do not publish it (health is internal on purpose) |
| `auth.api.spec.ts` | Smoke: `GET /connections` is 401 without a session and 200 with one |
| `sign-in.api.spec.ts` | Wrong password and unknown email, session lookup, tampered cookies, closed self-registration, sign-in rate limit |
| `authorization.api.spec.ts` | 401 without a session and 403 for a non-admin user, one test per admin endpoint |
| `connections.api.spec.ts` | Connection CRUD (an update keeps the engine unless it names one), validation, no password in responses, `test-raw`, testing a saved connection |
| `cronjobs.api.spec.ts` | Cronjob create, update and toggle; an update keeps an active cronjob scheduled (non-null `nextRunAt` in the response and on a re-read) and a new expression moves its next run |
| `error-envelope.api.spec.ts` | The error body for 400, 401, 403 and 404, the success body, ids that are not UUIDs |
| `read-contracts.api.spec.ts` | Shapes and count invariants (totals add up, counts are whole numbers that are not negative, lists are arrays) of the jobs, analytics, backups, restores and audit endpoints; the job tables are never empty for long because the `pipeline` project fills them |

UI spec files (the page objects are in `e2e/support/pages/`; locators use the English copy of the web app, which is what it shows when the browser has no stored language):

| File | Covers |
|------|--------|
| `login.ui.spec.ts` | Form, browser validation of empty and malformed input, wrong password, rate-limit message, successful sign-in that survives a reload, password toggle, logout of its own session, signed-in visitors leaving `/login`, API unreachable |
| `navigation.ui.spec.ts` | Sidebar sections and links, opening every section as admin, what a regular user sees, is redirected from and can open, the data behind the screens a regular user opens (known defect), unknown addresses |
| `connections.ui.spec.ts` | Empty state, creation form and its validation, creating PostgreSQL and MySQL connections, testing from the form and from a row, filtering, editing, deleting and cancelling the confirmation, wording of the success toast |
| `dashboard.ui.spec.ts` | Title and KPI cards, panels, only successful requests, an empty system |
| `dumps.ui.spec.ts` | Starts a backup from the Dumps page and sees it completed in the history (the real pipeline runs behind the screen) |

The login specs run in a window 1000 px wide: from 1024 px the sign-in screen paints an animated WebGL panel that headless Chromium renders in software, which made each test several seconds slower (1.2 minutes for the file at 1280 px against 18 seconds), and below that width the app hides it. Specs that need a state the shared stack cannot promise (no connections, no jobs) answer the `GET` with `mockApiGet` from `e2e/support/mock-api.ts`; all other traffic is real.

### Signing in from a spec

Better Auth allows only 3 sign-ins per 10 seconds per client IP and the limit cannot be configured. Two rules keep the suite under it:

- `setup` is the only place that signs in through the web proxy. It does so at most once per run, and not at all while the saved session is still accepted (it asks `GET /api/auth/get-session?disableCookieCache=true`, which checks the database instead of the cached cookie), so back-to-back runs never reach the limit.
- A spec that needs a sign-in of its own (wrong credentials, the non-admin user, the rate-limit guard) calls `signInOnDirectApi` from `e2e/support/api.ts`. It posts to the API port (`:3000`) with a unique `X-Forwarded-For` header. Behind the proxy every client shares one address, because nginx overwrites that header; the API port trusts it, so each sign-in gets a bucket of its own and never touches the one `setup` uses.

Never sign out the shared admin session: every other spec uses it. The non-admin user is created once per worker through the Better Auth admin plugin and removed when the worker ends.

### Browser specs and the rate limit

Better Auth also limits every other `/api/auth/*` path to 100 requests per 10 seconds per client IP, and the web app calls `get-session` on every page it opens. Through the proxy all browser contexts, workers and projects share one address, so a parallel UI run exhausts that allowance: the app reads the 429 as "signed out" and the spec ends on the login page, at random (without the routing below, `--repeat-each=3` over the UI project failed 7 tests this way).

The suite avoids this without mocking the sign-in. The `context` fixture of `e2e/support/fixtures.ts` calls `routeAuthToOwnRateLimitBucket` (`e2e/support/browser.ts`), which repeats each `/api/auth/*` request of the browser against the API port with an `X-Forwarded-For` address of its own and hands the answer back to the page. The real form talks to the real API, and the browser ends up with the real session cookies (they depend on the host name, not the port). Only the hop through nginx is skipped, and only for these calls; `setup` and the API project still use the proxied auth routes.

- Import `test` from `e2e/support/fixtures`, never from `@playwright/test`, in every UI spec.
- A route that a spec adds to its page wins over this one, so a spec can still answer a sign-in with a canned response (the rate-limit message and the network failure do).
- A spec that signs in or out must use a context of its own (`test.use({ storageState: SIGNED_OUT })`), never the shared admin session.

---

## Backup and restore tests

The `pipeline` project proves that backup and restore work end to end: the HTTP API, the BullMQ queue, `pg_dump` / `mysqldump` inside the API container, object storage (MinIO), `pg_restore` / `mysql`, and real databases at both ends. It stays outside, as any client would: it talks to the API and looks at the databases and the object store.

### What a test does

Every test works on data of its own, so the project runs in parallel and can be repeated.

| Step | How |
|------|-----|
| 1. Source | Creates a database named `e2e_<engine>_<role>_<id>` on the source server and seeds two tables: 3000 items (NULLs, accents, CJK text, an emoji, quotes and backslashes, a decimal) and 300 tags that reference them through a foreign key. |
| 2. Connection | Registers it through the API as a `prod` connection (the API reaches the servers as `db-test-pg` and `db-test-mysql`). A restore target is another, empty database registered as `dev` or `qa`. |
| 3. Job | `POST /api/backups` or `POST /api/restores`, then polls the job every 250 ms until it is `completed`. The deadline is 60 s; a job that fails or does not finish ends the test with its status and `errorMessage`. |
| 4. Proof | A backup is proven in storage: the dump downloaded through its signed URL has the recorded size and SHA-256, and the manifest object describes the run. A restore is proven in the target: the same tables, constraints, indexes and row counts as the source, and the same SHA-256 over every row in primary key order. |
| 5. Cleanup | Always, even when the test fails: unfinished jobs are cancelled, the dump and manifest objects are deleted, the connections are deleted through the API and the databases are dropped. |

### Pipeline spec files

| File | Covers |
|------|--------|
| `backup.pipeline.spec.ts` | PostgreSQL and MySQL: job fields and timings, the dump served through its signed URL (size and SHA-256), dump and manifest in storage, the storage listings, the server version in the manifest, a pending backup returned to repeated requests and then cancelled |
| `restore.pipeline.spec.ts` | Restore into `dev` and `qa` targets with row counts and a data checksum equal to the source, restore by object key, dry run (the plan, the manifest, a target left untouched), restore on a PostgreSQL older than 17 (D1) |
| `rules.pipeline.spec.ts` | What is refused: restore into `prod`, a backup of the other engine, unknown and malformed requests, a restore with no source, a backup of a connection that is not in production, listing dumps |
| `backup-failure.pipeline.spec.ts` | Backups of a source with a wrong password, a host that does not resolve or a database that does not exist end `failed`, with an error message and no object in storage |
| `observability.pipeline.spec.ts` | A completed backup and restore appear in the job lists, the history, the daily analytics, the summary and the storage totals |

A failing backup is attempted twice, 5 seconds apart. The job is already reported `failed` after the first attempt and the retry rewrites it, so the failure tests wait for the second attempt and take about 6 seconds each.

### Source databases and cleanup

The tests reach the servers from the host, on the ports Compose publishes: PostgreSQL at `localhost:5435` as `test_user` (a superuser), MySQL at `localhost:3307` as `root` / `root_pass123` (`test_user` only owns `testdb`, and a MySQL restore creates staging databases), and MinIO at `localhost:9000` with the `R2_*` credentials of `.env.e2e`. `E2E_PG_PORT`, `E2E_MYSQL_PORT` and `E2E_MINIO_PORT` change them (see [Environment variables the tests read](#environment-variables-the-tests-read)).

The test databases are called `e2e_...` and are dropped when the test ends, together with the staging databases a MySQL restore leaves if it is killed half-way. A run killed hard (not with `Ctrl+C`) skips that cleanup and leaves its databases, connections and objects until `pnpm docker:e2e:down`. The API has no endpoint that deletes a job, so job rows stay (as `completed` or `failed`) for the life of the stack; this is why `read-contracts.api.spec.ts` checks invariants and not counts.

### PostgreSQL older than 17 (D1)

The API image ships `pg_restore` 18, which cannot restore into a PostgreSQL older than 17 (defect D1). The default source image is `postgres:18-alpine`, so by default the PostgreSQL restore test runs and the D1 test is skipped. To run D1, start the stack with an older source, run the project, and go back to the default image:

```bash
pnpm docker:e2e:down                                # start from a clean stack
E2E_PG_IMAGE=postgres:16-alpine pnpm docker:e2e     # start with a PostgreSQL 16 source
pnpm test:e2e --project=pipeline                    # D1 runs, the PostgreSQL restore test is skipped
pnpm docker:e2e:down && pnpm docker:e2e             # back to the default image
```

On PostgreSQL 16 the D1 test passes: the restore job ends `failed` with `transaction_timeout` in its error message and the target stays empty. The PostgreSQL restore test is skipped with a message that points to D1; everything else, MySQL restores included, behaves as with the default image. When D1 is fixed the D1 test starts failing, which is the signal to delete it and its row in [Known defects](#known-defects).

---

## Performance suite

The `perf` project measures how fast the stack backs up and restores databases, how the BullMQ queues behave when requests arrive together, how quickly the screens load and how fast the API answers. It is a benchmark, not a test of behavior: it has a config of its own (`e2e/playwright.perf.config.ts`) and is **never part of `pnpm test:e2e`**. The full default run takes about 17 minutes on the machine of the reference run (16 CPUs and 16 GiB for Docker). It fails only on functional errors (a job that fails, a restored table with the wrong row count, a timeout); there are no speed thresholds, so a slow machine never turns it red.

### Run it

| # | Command | What it does |
|---|---------|--------------|
| 1 | `pnpm docker:e2e` | Starts the stack, as for the functional suite. |
| 2 | `pnpm test:e2e:perf:unit` | Unit tests of the statistics helpers, the report builders and the settings parser. They need no stack. |
| 3 | `pnpm test:e2e:perf` | Runs the full default suite (the unit tests first) and writes a results folder. |
| 4 | `pnpm docker:e2e:down` | Stops the stack and deletes its data. |

Close heavy applications first and leave the stack alone while it measures: the numbers are only meaningful on a quiet machine.

### What is measured

| Group | What it measures | Spec |
|-------|------------------|------|
| Dump and restore throughput | For PostgreSQL and MySQL at each dataset size: the backup (queue wait `startedAt - createdAt`, duration `completedAt - startedAt`, wall time seen by the test, dump size, throughput over the source size and over the dump size), then the restore of that dump into a fresh empty `dev` database (queue wait, duration, throughput) and a row count of every table against the source. | `backup-restore.perf.spec.ts` |
| BullMQ concurrency | K simultaneous backups of K different connections (K = 1, 2, 4, 6): queue wait of each job by start order, duration, makespan and parallelism; and one against two simultaneous restores. | `concurrency.perf.spec.ts` |
| Front-end | Cold loads in Chromium of the login page (narrow and wide), the dashboard and the connections page: TTFB, DOMContentLoaded, load, FCP, LCP, bytes transferred and requests made. | `latency-web.perf.spec.ts` |
| API latency | 100 sequential requests to each of `GET /api/connections`, `GET /api/jobs/summary`, `GET /api/jobs/analytics/daily?window=7` and `GET /api/backups/history`: p50, p95 and p99. | `latency-api.perf.spec.ts` |
| Helpers | Percentiles and statistics, the report builders, the settings parser and the gating of the two configs. | `stats.unit.spec.ts`, `report.unit.spec.ts`, `config.unit.spec.ts` |

Everything runs in one worker, one test at a time, in this order: backup and restore, BullMQ, API latency, front-end. The heavy cases come first so that the light ones are measured on a system that already has job history. Every case starts with one warm-up repetition that is recorded and left out of the statistics, because the first dump of a freshly loaded database pays for cold caches and the first connection to the object store. Durations come from the timestamps the API stores with each job (milliseconds), never from how often the test polls (every 250 ms).

### Datasets

Each engine gets a database generated inside the server with set-based SQL (`generate_series` on PostgreSQL; on MySQL an insert-select over a table of numbers that is doubled until it is big enough), once per engine and size, before the timed repetitions and never counted in them. Every value is a function of the row id, so a size always produces the same rows. Both engines get the same number of rows with the same shape; the sizes differ a little because each engine stores them in its own way.

There are three tables linked by foreign keys, with indexes: `perf_customers` (uuid, text, an e-mail with a unique index, a decimal, a timestamp, a JSON profile), `perf_orders` (4 per customer; uuid, status, decimal, JSON, text; indexes on the customer and the date) and `perf_events` (4 per order, so most of the bytes; a 132-character payload made of three SHA-256 digests in base64, JSON details; an index on the order). The payload looks random on purpose, so the dump does not compress away: the PostgreSQL custom format ends at about 0.42 of the source size and the MySQL dump, plain SQL text, at about 0.8 to 0.9.

| Size | Target | Customers | Orders | Events | Source PostgreSQL | Source MySQL |
|------|--------|-----------|--------|--------|-------------------|--------------|
| `small` | 10 MiB | 1,500 | 6,000 | 24,000 | 10.2 MiB | 10.1 MiB |
| `medium` | 100 MiB | 15,000 | 60,000 | 240,000 | 99.4 MiB | 94.7 MiB |
| `large` | 500 MiB | 75,000 | 300,000 | 1,200,000 | 496 MiB | 463 MiB |
| `xlarge` (opt-in) | 1 GiB | 155,000 | 620,000 | 2,480,000 | 1,025 MiB | 953 MiB |

The source size is tables plus indexes as the server reports them (`pg_table_size` + `pg_indexes_size`; `DATA_LENGTH` + `INDEX_LENGTH`) and is what the throughput figures divide; the dump size comes from the backup job. The sizes above were measured on a reference run and `summary.md` reports the ones of every run. MiB is 1,048,576 bytes.

### Settings

The defaults are the `full` preset. Each variable overrides it; set them in `.env.e2e` (commented examples are in `.env.e2e.example`) or export them in the shell, where they win over the file.

| Variable | Default | Effect |
|----------|---------|--------|
| `E2E_PERF_PRESET` | `full` | `quick` is a smoke check of the whole harness (about a minute): both engines, the small dataset, 2 runs, K = 1, 2, 4, 3 page loads and 20 API requests. |
| `E2E_PERF_ENGINES` | `postgres,mysql` | Engines to measure. |
| `E2E_PERF_SIZES` | `small,medium,large` | Dataset sizes. Add `xlarge` (about 1 GiB) to opt in. |
| `E2E_PERF_RUNS` | 20 small, 20 medium, 10 large, 3 xlarge | Measured repetitions per case, warm-up not counted. A single number applies to every size. |
| `E2E_PERF_QUEUE_SIZE` | `medium` | Dataset of the BullMQ experiments. |
| `E2E_PERF_QUEUE_K` | `1,2,4,6` | Simultaneous backups, one case per value (1 to 12). |
| `E2E_PERF_QUEUE_RESTORES` | `1,2` | Simultaneous restores, one case per value. |
| `E2E_PERF_QUEUE_RUNS` | `5` | Measured repetitions per BullMQ case. |
| `E2E_PERF_UI_RUNS` | `20` | Cold loads per page (the wide login page uses at most 10). |
| `E2E_PERF_API_REQUESTS` | `100` | Sequential requests per endpoint, after 5 warm-ups. |

### Variants

Flags and file names go straight after `pnpm test:e2e:perf`, **without** a `--` separator, as for `pnpm test:e2e`. A file name selects that spec only; the unit tests and `setup` still run first.

```bash
pnpm test:e2e:perf                       # the full default suite
pnpm test:e2e:perf --list                # what would run, without running anything
pnpm test:e2e:perf:unit                  # unit tests of the helpers only, no stack
E2E_PERF_PRESET=quick pnpm test:e2e:perf # smoke check of the whole harness
E2E_PERF_ENGINES=postgres E2E_PERF_SIZES=small,medium E2E_PERF_RUNS=5 pnpm test:e2e:perf backup-restore   # chosen engine, sizes and runs; backup and restore spec only
E2E_PERF_SIZES=xlarge E2E_PERF_RUNS=1 pnpm test:e2e:perf backup-restore   # the 1 GiB dataset, one run
pnpm test:e2e:perf latency-web           # one spec file (backup-restore, concurrency, latency-api, latency-web)
```

In PowerShell set the variable first and clear it afterwards: `$env:E2E_PERF_PRESET = 'quick'; pnpm test:e2e:perf; Remove-Item Env:E2E_PERF_PRESET`.

### Results

Every run writes a new folder, `e2e/perf-results/<UTC timestamp>/` (git-ignored), and never touches an earlier one. The specs save each case as they measure it, and when the run ends, even if it failed, the reporter merges the cases into three files:

| File | Content |
|------|---------|
| `results.json` | The raw sample of every repetition (warm-ups flagged `warmup: true`), the statistics, the environment (commit, Node.js, Playwright and Chromium versions, host and Docker VM resources, source PostgreSQL and MySQL versions, `pg_dump` and `mysqldump` versions of the API image, the `E2E_*` variables), the settings and the dataset definitions with their real sizes. |
| `summary.csv` | One row per case and metric, with the columns `group,case,metric,unit,n,min,p50,p95,p99,max,mean,stddev,complete`, ready for a spreadsheet. |
| `summary.md` | Readable tables, one per metric group and with the unit in the title, to paste into a report. |

How to read the statistics:

- **p50** is the median; **p95** and **p99** are percentiles computed by linear interpolation between the closest ranks (method R-7, the default of NumPy and of Excel's `PERCENTILE.INC`); **σ** is the sample standard deviation (n - 1).
- With fewer than 20 samples p95 lies between the two largest values, so it is effectively the maximum; it is reported anyway so that every table has the same shape. By default `small` and `medium` have 20 runs, so they have a real p95, and the 100 API requests give a real p99; `large` has 10 and the BullMQ cases 5.
- **Duration** is `completedAt - startedAt` of the job; **queue wait** is `startedAt - createdAt`; **wall time** is what the test saw from its request to the poll that found the job completed, so it can be up to 250 ms longer than the duration. **Throughput** is MiB per second over the source size and over the dump size.
- A `*` after a size in `summary.md` (`complete` false in the CSV) marks a case that stopped before its last repetition.
- The numbers belong to this machine and to the local MinIO: they say nothing about the network hop to Cloudflare R2.

An example of the format (rows of the "Backup duration (s)" table from one reference run; they show the shape, not figures to compare your machine with):

| Engine | Size | n | min | p50 | p95 | max | mean | σ |
|:---|:---|---:|---:|---:|---:|---:|---:|---:|
| PostgreSQL | medium | 20 | 1.83 | 1.85 | 2.02 | 2.36 | 1.89 | 0.12 |
| MySQL | medium | 20 | 0.77 | 0.80 | 0.82 | 0.82 | 0.80 | 0.01 |

### The BullMQ staircase

The `backup` queue has concurrency 2 and the `restore` queue concurrency 1. When K backups of K different connections are requested together, two start at once and each further job waits for a free worker, so the queue wait by start order climbs one step (about one backup) every two jobs and the makespan (first request to last completion) grows in steps too, while the parallelism stays near 2.

| K | Expected shape |
|---|----------------|
| 1, 2 | Everything starts at once: a makespan of one backup and queue waits of a few milliseconds. |
| 4 | Two waves: jobs 3 and 4 wait about one backup, and the makespan is about two. |
| 6 | Three waves: jobs 5 and 6 wait about two backups, and the makespan is about three. |

With a single restore worker restores are strictly sequential: of two simultaneous restores the second waits for the first, so its queue wait is about one restore and the gap between the two completions is about one restore. The K connections are K different connection records, because a second backup of the same connection is deferred with a backoff of 30 to 300 seconds, which would measure that policy and not the queue; they point at one source database, which keeps the load of every job identical. In the reference run, PostgreSQL with K = 6 had queue waits by start order of 0.01, 0.01, 2.07, 2.10, 4.10 and 4.15 s (a step of about one backup, 2 s, every two jobs) and a makespan of 6.28 s against 1.92 s for K = 1, with a parallelism of 1.99; MySQL showed the same steps of about 1 s. Of two simultaneous restores the second waited 1.08 s on PostgreSQL and 4.49 s on MySQL, the duration of one restore, and their completions were 1.13 s and 4.37 s apart.

### Caveats

- Run it on a quiet machine: close heavy applications and do not use the stack or run other suites while it measures. The host and Docker VM resources are saved in `results.json` so that a result can be read against the machine that made it.
- The first run of each case is a warm-up: it is kept in `results.json` and left out of every statistic.
- Object storage is MinIO on the same Docker VM, so dump and restore times exclude the network hop to Cloudflare R2.
- The login page is measured below 1024 px (1000 x 800) because from 1024 px the sign-in screen paints an animated WebGL panel that headless Chromium draws in software; that wide case is measured apart and labelled `Login (WebGL panel)`. In the reference run it did not differ from the narrow case (median LCP 386 ms against 416 ms).
- Job rows pile up for the life of the stack and the API endpoints answer more slowly with more rows behind them (`summary.md` lists the rows each response had). For comparable numbers start from a clean stack: `pnpm docker:e2e:down`, then `pnpm docker:e2e`.
- The `xlarge` dataset needs a few GB of free space in the Docker VM for the source, the dump and the restore target, and takes about 4 minutes for one run of both engines.
- On a PostgreSQL older than 17 the PostgreSQL cases are skipped, because the restore fails there (D1).
- The MySQL source runs with its binary log disabled (`--skip-log-bin`). Before that setting a default performance run left about 7.5 GB of binary logs in its volume (MySQL 8 logs every seed and restore and keeps the logs for 30 days); after it, a quick MySQL-only run left a data directory of about 200 MB with no binary log files. `pnpm docker:e2e:down` still removes all the data.
- A run killed hard leaves its `e2e_...` databases, connections and dumps until `pnpm docker:e2e:down`.

---

## Run variants

Pass flags straight after `pnpm test:e2e`, **without** a `--` separator (with it, pnpm forwards the `--` and Playwright ignores the project filter).

```bash
pnpm test:e2e --project=api                      # API specs only
pnpm test:e2e --project=pipeline                 # backup and restore specs only
pnpm test:e2e --project=ui-chromium              # browser specs only
pnpm test:e2e tests/ui/connections.ui.spec.ts    # one UI file
pnpm test:e2e --project=ui-chromium -g "wrong password"   # UI tests whose title matches
pnpm test:e2e tests/api/connections.api.spec.ts  # one file
pnpm test:e2e tests/pipeline/restore.pipeline.spec.ts   # one pipeline file
pnpm test:e2e -g "login"                         # tests whose title matches
pnpm test:e2e --project=api -g "test-raw"        # API tests whose title matches
pnpm test:e2e --project=pipeline -g "MySQL"      # pipeline tests whose title matches
pnpm test:e2e --project=api --repeat-each=3      # run every API test 3 times to expose flakiness
pnpm test:e2e --project=pipeline --repeat-each=3 # the same for backup and restore
pnpm test:e2e --project=pipeline --workers=1     # one pipeline test at a time
pnpm test:e2e --project=ui-chromium --headed     # watch the browser
pnpm test:e2e --project=ui-chromium --workers=1  # one browser at a time, easier to follow
pnpm test:e2e --ui                               # Playwright UI mode
pnpm test:e2e --project=ui-chromium --debug      # step through with the Inspector
pnpm test:e2e:report                             # open the HTML report
```

The `setup` project always runs first, so its test is counted in every run. The report is served at `http://localhost:9323` (press `Ctrl+C` to stop it). For browser specs, `--headed` and `--ui` show what the page does, `--workers=1` runs one browser at a time, and a failed test keeps its trace and screenshot in the report.

---

## Entry points

| What | Where | Notes |
|------|-------|-------|
| Web app + API proxy | `http://localhost:5173` | The API is under `/api`. |
| API (direct) | `http://localhost:3000` | The only place `/health` exists: health is internal on purpose and the web proxy does not publish it. Specs that sign in use it (see [Signing in from a spec](#signing-in-from-a-spec)). |
| MinIO (S3) | `http://localhost:9000` | Console on `http://localhost:9001`. Sign in with `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` from `.env.e2e`. |
| Source PostgreSQL | `localhost:5435` | Database `testdb`, user `test_user`, password `test_pass123`. The pipeline specs create their own `e2e_...` databases here. |
| Source MySQL | `localhost:3307` | Database `testdb`, user `test_user`, password `test_pass123`. The pipeline specs connect as `root` / `root_pass123` and create their own `e2e_...` databases. |

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
| `E2E_PG_PORT` | `5435` | Host port of the source PostgreSQL, for the pipeline specs. Keep it equal to the one Compose publishes. |
| `E2E_MYSQL_PORT` | `3307` | Host port of the source MySQL, for the pipeline specs. |
| `E2E_MINIO_PORT` | `9000` | Host port of MinIO, for the pipeline specs. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | from `.env.e2e` | MinIO account and bucket; the pipeline specs use them to look at the stored objects. |
| `E2E_PERF_PRESET`, `E2E_PERF_ENGINES`, `E2E_PERF_SIZES`, `E2E_PERF_RUNS`, `E2E_PERF_QUEUE_SIZE`, `E2E_PERF_QUEUE_K`, `E2E_PERF_QUEUE_RESTORES`, `E2E_PERF_QUEUE_RUNS`, `E2E_PERF_UI_RUNS`, `E2E_PERF_API_REQUESTS` | see [Settings](#settings) | What and how much the performance suite measures. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `pnpm docker:e2e` fails with `Bind for 0.0.0.0:5173 failed: port is already allocated` | Another stack (dev or prod compose, or another app) holds the port. | Stop it and run again. |
| `The E2E stack is not ready: ... (last result: ECONNREFUSED)` | The tests ran while the stack is down; they retry for 30 seconds before failing. | Run `pnpm docker:e2e`, then the tests again. |
| `couldn't find env file: ...\.env.e2e` or `E2E configuration is incomplete: ... .env.e2e does not exist` | `.env.e2e` is missing. | `cp .env.e2e.example .env.e2e` |
| Sign-in fails with HTTP 429 (`Too many requests`) | More than 3 sign-ins in 10 seconds through the proxy. `setup` signs in once at most, so this needs several runs started within seconds while there is no valid saved session (after `pnpm docker:e2e:down`, or with `e2e/.auth` deleted), or a spec that signs in through the proxy. | Wait 10 seconds and run again. In a spec, use `signInOnDirectApi`. |
| A UI spec ends on the login page although it has a session, or `/api/auth/get-session` answers 429 | More than 100 requests to the same `/api/auth/*` path (in practice `get-session`) in 10 seconds from one address; the app reads the 429 as signed out. The spec does not use the `context` fixture that gives the browser an address of its own. | Import `test` from `e2e/support/fixtures`, not from `@playwright/test` (see [Browser specs and the rate limit](#browser-specs-and-the-rate-limit)). |
| Sign-in fails with `INVALID_ORIGIN` | `E2E_BASE_URL` uses `127.0.0.1`. | Use `localhost`. |
| Sign-in fails with `INVALID_EMAIL_OR_PASSWORD`, or the stack boots with surprising values | A variable exported in your shell overrides `.env.e2e` (for Compose and for the tests). | Unset the variable in that shell. |
| `Expected to fail, but passed` on a spec marked `test.fail` | A known defect was fixed. | Delete the `test.fail` wrapper and the row in [Known defects](#known-defects). |
| Accounts named `e2e-user-...@envault.local` remain after an aborted run | The non-admin test user is removed when its worker ends; a killed run skips that. | `pnpm docker:e2e:down` deletes them with the rest of the data. |
| You need a clean slate | Data from a previous run is still in the volumes. | `pnpm docker:e2e:down` deletes the volumes; the next `pnpm docker:e2e` starts empty. |
| Restores fail with `unrecognized configuration parameter "transaction_timeout"` | The source PostgreSQL is older than 17, and the API image's `pg_restore` is version 18. | Keep `E2E_PG_IMAGE` at 17 or newer (default `postgres:18-alpine`). On an older server the pipeline project skips its PostgreSQL restore test and runs the D1 test instead (see [PostgreSQL older than 17 (D1)](#postgresql-older-than-17-d1)). |
| `Cannot reach the source PostgreSQL (localhost:5435) from the host` (or the MySQL one) | The stack is down, or a port was changed in Compose but not in `.env.e2e`, so the tests still look at the default. | Run `pnpm docker:e2e`, and set `E2E_PG_PORT` / `E2E_MYSQL_PORT` in `.env.e2e`, where both Compose and the tests read them. |
| `Backup job ... did not complete within 60 s` (or `Restore job ...`) | The worker did not finish the job in time: it is stuck, or the queue is busy with other jobs. The message carries the job's last status and error. | Run the test alone to see whether the stack is healthy; `pnpm docker:e2e:down` and `pnpm docker:e2e` give a clean one. |
| Databases named `e2e_...` remain on the source servers after an aborted run | The cleanup runs when the test ends; a run killed hard skips it. | `pnpm docker:e2e:down` removes them with the rest of the data. |
| A performance setting is rejected: `E2E_PERF_SIZES="..." is not valid` (or another `E2E_PERF_*` variable) | The value has a typo or is out of range. | Use the values in [Settings](#settings); the message lists the valid ones. |
| A performance case fails with `Backup job ... did not complete within ... s`, or the Docker VM runs out of disk | The dataset is larger than the machine can dump within the deadline (it grows with the size), or the VM has no free space for the source, the dumps and the restore copies. | Check `docker system df`, free some space, run a smaller size, or start from a clean stack with `pnpm docker:e2e:down` and `pnpm docker:e2e`. |
