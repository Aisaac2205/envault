# QA Report — EnVault Management

> 🇪🇸 Versión en español: [../es/qa-report.md](../es/qa-report.md)

This report presents the quality assurance (QA) work done on EnVault with an automated test suite built on [Playwright](https://playwright.dev): what was tested, how, what was found, how far the results can be trusted and what is still open. It describes the branch `feat/e2e-playwright-suite` at commit `9902fee`, on 2026-10-15. Every numbered section is written to stand on its own, so it can be copied alone into another document.

---

## 1. Summary

EnVault is a self-hosted application that backs up PostgreSQL and MySQL databases to object storage and restores them. Its quality was checked with an automated suite written with Playwright, a testing tool that sends HTTP requests to an API and drives a real web browser, run against a complete copy of the application in Docker. The work was done for a university QA course whose assignment was to take one of your own projects and write automated tests for it with a tool of your choice.

| Item | Result |
|------|--------|
| Functional suite (`pnpm test:e2e`) | 256 tests in 18 files: 149 API tests, 42 backup and restore tests, 64 browser tests and 1 sign-in step; 24.7 to 29.8 s per run with 8 parallel workers |
| Performance suite (`pnpm test:e2e:perf`) | 55 tests: 13 measurements, 41 unit tests of its own helpers and 1 sign-in step; about 17 minutes per full run |
| White-box unit tests (Jest and Vitest, already in the project) | API 548 tests, web app 202, landing page 42 |
| Reliability | 13 consecutive runs of the whole functional suite with different parallelism and repetition: 3838 test executions, 0 failures, 0 flaky tests |
| Reproducibility | A fresh clone of the repository, set up by following the written instructions literally, gave the same results; no instruction was wrong |
| Defects found | 18 (D1 to D18), among them a security defect (D6), a safety defect (D12) and a data-integrity defect (D15) |
| Defects fixed | 11, each one with a failing test written before the fix; 4 left open for a product or design decision, 1 confirmed and waiting for approval, 2 not confirmed |
| Code coverage of the API (lines) | 52.93% before the fixes, 61.18% after them |
| Backup time of a 500 MiB database (median, reference run) | PostgreSQL 8.73 s, MySQL 3.70 s |
| Restore time of the same database (median, reference run) | PostgreSQL 4.74 s, MySQL 19.86 s |

Verdict: within the conditions tested (one Windows machine, the Chromium browser, and object storage simulated locally with MinIO), the suite is reliable. Its results did not depend on the order of the tests, on the number of parallel workers or on repetition, and it runs from a fresh clone with the documented commands. It is not yet evidence for other operating systems, other browsers, the real Cloudflare R2 storage or heavy load, and it does not run in continuous integration (CI, an automatic run on every change) yet.

---

## 2. Context and choice of tool

The assignment of the university QA course was to take one of your own projects and write automated tests for it with a tool of your choice. The project chosen is EnVault, a self-hosted application that backs up and restores PostgreSQL and MySQL databases. The tool chosen is Playwright 1.63.0, an open-source test framework for web applications.

Before this work EnVault already had white-box unit tests: tests written by someone who sees the source code, each one checking a small piece in isolation, with its database and other dependencies replaced by fakes. They use Jest in the API and Vitest in the web app and the landing page, and they stay in place. What EnVault did not have was black-box testing (tests that only use the public interfaces, HTTP and the browser, without looking at the code), an environment with real databases and real object storage to run them against, or any performance measurement. Playwright was used to add those three things.

| Reason for Playwright | What it made possible in this project |
|-----------------------|---------------------------------------|
| One tool for API and browser tests | API tests use its built-in HTTP client (the `request` context); browser tests drive Chromium. Both share one runner, one report and the same helpers. |
| A real browser | The interface tests run in Chromium, the engine of Chrome and Edge, not in a simulated page. |
| Projects | One configuration splits the suite into the projects `setup`, `api`, `pipeline` and `ui-chromium`, each with its own timeouts; a second configuration holds the performance suite so it never runs by accident. |
| One sign-in for the whole run | The `setup` project signs in once and saves the session to a file (`storageState`); every other test reuses it. This was required because EnVault accepts only 3 sign-ins per 10 seconds from one address. |
| Control of the browser's network | `page.route` answers chosen requests with prepared responses, to show error states (the API unreachable, an empty list) that a shared environment cannot guarantee. |
| Known defects kept as tests | `test.fail` marks a test that is expected to fail because of a known defect: the run stays green while the defect exists and turns red when it is fixed, which is the signal to remove the mark. |
| Parallel workers and repetition | Workers are separate processes that run tests at the same time; `--workers` sets how many and `--repeat-each` runs every test several times. Both made the reliability study of this report possible. |
| Diagnostics | An HTML report of every run, and a trace and a screenshot kept for each failed test. |
| TypeScript | The same language as EnVault, so the tests follow the conventions of the code they test. |

Playwright does not measure code coverage (that stays with Jest and Vitest) and is not a load-testing tool, so neither of those is claimed for it in this report.

---

## 3. The system under test

EnVault is a self-hosted web application for database backups. An administrator registers database connections (PostgreSQL and MySQL), takes backups (dumps) of production databases, keeps them in object storage (Cloudflare R2 in production, a service compatible with Amazon S3) and restores them into development or QA databases. A restore into a production database is refused by design, because a restore overwrites the target.

| Part | Technology | Role |
|------|------------|------|
| API | NestJS 11 on Node.js, TypeScript, TypeORM | HTTP API under `/api`; sign-in with Better Auth (cookie sessions); two roles, `admin` and `user` |
| Queue | BullMQ on Redis | Runs backups (2 at a time) and restores (1 at a time) in the background |
| Dump tools | `pg_dump`, `pg_restore`, `mysqldump` and `mysql` inside the API container | Do the actual backup and restore work |
| Object storage | Cloudflare R2 | Keeps each dump and a manifest that describes it |
| Application database | PostgreSQL | Connections (with encrypted passwords), jobs, users and the audit log |
| Web app | React 19 and Vite, served by nginx | The administration interface; nginx also forwards `/api` to the API |
| Scheduler | Cron jobs inside the API | Automatic, scheduled backups |

The risky parts, and therefore the focus of the tests, are the stored database passwords (security), the restore, which overwrites a database (safety), and the dump itself, which is only useful if it can be restored to identical data (integrity). More detail is in [architecture.md](architecture.md).

---

## 4. Test environment

All the tests in this report run against a complete copy of EnVault started with Docker Compose. The environment is hermetic: everything it needs runs on the local machine, nothing outside it is called, and every run starts from the same known state. It is defined in `docker-compose.e2e.yml`, which is added on top of the production compose file, and configured by `.env.e2e`, a copy of `.env.e2e.example`.

| Service | Image | Role in the tests |
|---------|-------|-------------------|
| `api` | Built from `apps/api`, production target | The system under test |
| `web` | Built from `apps/web`, production target (nginx) | The system under test; the entry point is `http://localhost:5173` |
| `db` | `postgres:16-alpine` | EnVault's own database |
| `redis` | `redis:7-alpine` | The BullMQ queues |
| `db-test-pg` | `postgres:18-alpine` (changeable with `E2E_PG_IMAGE`) | PostgreSQL databases to back up and to restore into |
| `db-test-mysql` | `mysql:8.0` | MySQL databases to back up and to restore into |
| `minio` | `pgsty/minio`, pinned by digest | Object storage compatible with S3, standing in for Cloudflare R2 |
| `minio-init` | `pgsty/mc`, pinned by digest | Creates the storage bucket once and exits |

| Decision | Why |
|----------|-----|
| Production images, not the development ones | The development setup swaps in development builds and mounted source folders, which would distort the behavior and the timings being measured. |
| MinIO instead of Cloudflare R2 | The API had the R2 address written into its code, so it could not run without a real cloud account. A small product change (commit `e0146d0`) added an optional `R2_ENDPOINT` variable: when it is set the API talks to that S3-compatible address, and when it is not set nothing changes, so production is unaffected. |
| A Compose project of its own (`envault-e2e`) and its own ports | The test stack can never touch another stack's containers or data; only port 5173 is shared with the development stack. |
| Test-only credentials | `.env.e2e.example` contains values made for this environment: no cloud key or real secret is needed. |
| MySQL binary log turned off (`--skip-log-bin`) | One full performance run had left about 7.5 GB of MySQL logs on disk. |
| Two commands | `pnpm docker:e2e` builds, starts and waits until every service is healthy; `pnpm docker:e2e:down` removes the containers and all their data. |

Why a hermetic environment: it is reproducible (every run starts from the same state), free (no cloud account and no cost), safe (no real data is involved) and ready for CI (no secrets to manage). Its tradeoff: MinIO is not R2, so the timings leave out the network trip to Cloudflare and any behavior specific to R2 is not tested. Because `R2_ENDPOINT` is optional, a run against a real R2 bucket needs only real credentials, not a code change.

Start-up times observed: the first build takes about 3 minutes (194.5 s); a start with the images already built took 24.9 s.

| Machine used for every result in this report | Value |
|----------------------------------------------|-------|
| Operating system | Windows 11 Pro (10.0.26300), x64 |
| Processor and memory | AMD Ryzen 7 7700X3D, 8 cores and 16 threads; 31.7 GiB of RAM |
| Docker | Docker 29.8.2, Compose v5.5.1 |
| Node.js and pnpm | Node.js 24.21.0, pnpm 10.30.0 |
| Test tool | Playwright 1.63.0 with Chromium |

---

## 5. Test strategy and test types

EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases) was tested at two levels. Black-box tests use only the public interfaces, HTTP and the browser, as a user or another program would, against the complete hermetic Docker environment; they were written with Playwright. White-box tests look inside the code, check one piece at a time with fakes in place of the database and other services, and were already in the project (Jest and Vitest).

| Type | Level | Command | Tests | What it checks |
|------|-------|---------|------:|----------------|
| API tests | Black-box | `pnpm test:e2e` (project `api`) | 149 | Sign-in, permissions, connections, error format and the shape of the read-only endpoints |
| Interface tests | Black-box | `pnpm test:e2e` (project `ui-chromium`) | 64 | Login, navigation and roles, connections screen, dashboard, unknown addresses, a backup started from the Dumps screen |
| Backup and restore pipeline | Black-box, end to end | `pnpm test:e2e` (project `pipeline`) | 42 | Real backups and restores of PostgreSQL and MySQL, with the data checked at both ends |
| Sign-in step | Support | `pnpm test:e2e` (project `setup`) | 1 | Signs in once and saves the session for the other tests |
| Performance | Black-box, measurement | `pnpm test:e2e:perf` | 13 + 41 + 1 | Backup and restore speed, queue behavior, page load times, API latency (13 measurements, 41 unit tests of the helpers, 1 sign-in step) |
| Unit tests | White-box | `pnpm test`, `pnpm test:coverage` | 548 + 202 + 42 | API (Jest), web app and landing page (Vitest), with code coverage |

The test counts come from `playwright test --list` on commit `9902fee` (functional suite: 256 tests in 18 files; performance suite: 55 tests) and, for the unit tests, from the runs of `pnpm test` recorded after the last defect fix (2026-10-14 and 2026-10-15).

| File | Project | Tests |
|------|---------|------:|
| `setup/auth.setup.ts` | `setup` | 1 |
| `api/auth.api.spec.ts` | `api` | 2 |
| `api/authorization.api.spec.ts` | `api` | 33 |
| `api/connections.api.spec.ts` | `api` | 45 |
| `api/error-envelope.api.spec.ts` | `api` | 26 |
| `api/health.api.spec.ts` | `api` | 3 |
| `api/read-contracts.api.spec.ts` | `api` | 30 |
| `api/sign-in.api.spec.ts` | `api` | 10 |
| `pipeline/backup.pipeline.spec.ts` | `pipeline` | 11 |
| `pipeline/backup-failure.pipeline.spec.ts` | `pipeline` | 4 |
| `pipeline/observability.pipeline.spec.ts` | `pipeline` | 1 |
| `pipeline/restore.pipeline.spec.ts` | `pipeline` | 8 |
| `pipeline/rules.pipeline.spec.ts` | `pipeline` | 18 |
| `ui/connections.ui.spec.ts` | `ui-chromium` | 21 |
| `ui/dashboard.ui.spec.ts` | `ui-chromium` | 5 |
| `ui/dumps.ui.spec.ts` | `ui-chromium` | 1 |
| `ui/login.ui.spec.ts` | `ui-chromium` | 12 |
| `ui/navigation.ui.spec.ts` | `ui-chromium` | 25 |

### API tests

What they do: they call the API over HTTP with Playwright's request context, as any client program would, and check status codes and response bodies. Example: one test creates a database connection and checks that no response ever contains its password, neither as typed nor encrypted; another table of tests calls every admin-only endpoint without a session (it must answer 401, "not signed in") and as a regular user (it must answer 403, "not allowed"). Why it matters: the API is the contract every other part depends on, and security rules are best checked where they are enforced.

### Interface tests

What they do: they open the web app in a real Chromium browser and act as a person would: fill forms, click buttons, follow links. Example: one test creates a PostgreSQL connection through the form and then confirms through the API that it was stored with the right values; another signs in and checks that the session survives a page reload. Why it matters: a working API does not prove that the screens use it correctly; four of the defects in this report (D8 to D11) were found by the browser tests.

### Backup and restore pipeline tests

What they do: each test creates its own database, fills it with 3000 rows of awkward data (empty values, accents, Chinese characters, an emoji, quotes, backslashes, decimals) and 300 rows that reference them, registers it in EnVault, asks for a backup and waits until the job is completed. It then downloads the dump and checks its size and its SHA-256 (a fingerprint of the file that changes if a single byte changes) against what EnVault recorded, restores it into an empty database and checks that tables, constraints, indexes, row counts and a SHA-256 over every row are equal to the original. Everything is deleted at the end, even when the test fails. Why it matters: a backup tool is only as good as its restores, and only an end-to-end test (one that crosses every part of the system: API, queue, dump tools, storage and databases) can prove that the data comes back identical.

### Performance tests

What they do: they time backups and restores of generated databases of about 10 MiB, 100 MiB and 500 MiB, several simultaneous backups to observe the queue, cold page loads in Chromium and 100 sequential requests to four API endpoints. They have a separate command and configuration, so they never slow down the functional suite, and they fail only on functional errors, never because a machine is slow. Why it matters: it gives reference numbers for capacity planning and shows where the system is slow.

### White-box unit tests

What they do: they check functions, services and components one by one, with the database, Redis and storage replaced by fakes, and a coverage tool reports which lines and branches of the code they executed. Why it matters: they are fast (about 20 s for all three packages with a warm cache) and point at the exact place of a failure; every defect fix in this work except one container setting (D2) started with a new unit test.

---

## 6. Test design techniques

The black-box tests of EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases) were designed with the techniques below. Only techniques that are actually present in the suite are listed.

| Technique | What it means | Where it is used |
|-----------|---------------|------------------|
| Table-driven tests | One test body run over a table of inputs, so each case is one row and a missing case is easy to see | `authorization.api.spec.ts`: one test per admin endpoint, 401 without a session and 403 for a regular user; the not-found and error-format tables in `error-envelope.api.spec.ts` |
| Equivalence classes and boundary values | Inputs are grouped into classes that should behave the same, and the values at or just past the limits are tried | Connection validation: port 0, a port above 65535, a fractional or non-numeric port, a name over 100 characters, an unknown engine or environment, an unexpected field |
| Authorization matrix by role | Each action is tried with no session, as a regular user and as an administrator | API (401 and 403 tables) and interface (which links a regular user sees and which addresses send them away) |
| Negative testing | Invalid or hostile inputs that must be refused cleanly | Wrong password, unknown email, tampered session cookie, body that is not JSON, an unknown host, a closed port, a restore into production |
| State transitions of jobs | A job must move through valid states in a valid order | A backup or restore goes from pending to completed or failed; its timestamps satisfy `createdAt <= startedAt <= completedAt`; a pending backup requested again returns the same job and can be cancelled |
| Data-integrity checks | The result is compared with an independent reference, not just accepted | SHA-256 of the downloaded dump against the recorded one; row counts and a SHA-256 over every row of the restored database against the source |
| Test isolation | Tests never depend on each other or on leftover data | Unique names in every test, cleanup that always runs, one database per pipeline test; this is what allows parallel runs |
| Test doubles in the browser | A prepared answer replaces a real one, only where the real state cannot be guaranteed | `page.route` returns an empty list, a rate-limit error or a network failure; all other traffic is real |
| One sign-in per run | The session is created once and shared | The `setup` project saves it with `storageState`, because EnVault accepts only 3 sign-ins per 10 seconds from one address |
| Known defects as executable tests | A test asserts the correct behavior and is marked as expected to fail | `test.fail` on the 4 D8 tests; until the defect is fixed Playwright counts them as passed |
| Checking that the tests can fail | The code or the expectation is broken on purpose, to prove the test notices | While the API, interface, pipeline and performance suites were written, expectations were broken on purpose (for example a wrong checksum or a wrong status); every defect fix was checked by restoring the old code and seeing the new tests fail |

---

## 7. Defects found

Writing and running the tests of EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases) uncovered 18 defects, numbered D1 to D18 in the order they were found. A severity is shown only where one was recorded when the defect was found; the others were not formally rated. Commits are on the branch `feat/e2e-playwright-suite`.

| Id | Defect | Severity (as recorded) | How it was found | Status |
|----|--------|------------------------|------------------|--------|
| D1 | Restores into a PostgreSQL older than 17 fail: the API image ships `pg_restore` 18, which aborts on `SET transaction_timeout` | Not rated | Building the test environment | Open: needs a product decision |
| D2 | The web container's health check probes `localhost`, which resolves to IPv6, while nginx listens on IPv4 only, so the container is reported unhealthy | Not rated | Building the test environment | Fixed in `7dadbc2` |
| D3 | The sign-in limit (3 per 10 seconds per address) is hard-coded and cannot be configured | Not rated | Building the test environment | Open: needs a design decision |
| D4 | The dashboard code called `/api/health`, an address the API does not serve | Not rated | Code reading, confirmed by the API tests | Fixed in `83627f6` (the unused code was removed; health stays internal) |
| D5 | Debug log lines still appear in production | Not rated | Building the test environment (container logs) | Fixed in `ab7152c` |
| D6 | Updating a connection returned its database password, decrypted, in the response | Security (rated critical by an automated review) | API tests | Fixed in `7cb0f2c` |
| D7 | An id that is not a UUID reached the database and caused a 500 error instead of a 400 | Not rated | API tests | Fixed in `de1557a` |
| D8 | A regular user is offered four screens whose data the API refuses (403), and sees zeros or an endless loading state with no message | Not rated (candidate: product intent to confirm) | Interface tests | Open: needs a product decision; 4 tests marked `test.fail` |
| D9 | An unknown address showed the router's developer error page | Not rated | Interface tests | Fixed in `4741c9d` |
| D10 | The latency message after a connection test was in Spanish in the English interface | Not rated | Interface tests | Fixed in `999b710` |
| D11 | When the API cannot be reached at sign-in, the button stays on "Signing in..." forever, with no message | Not rated | Interface tests | Fixed in `00b4e11` |
| D12 | A restore request that named no source backup was accepted and used an arbitrary backup | Safety | Pipeline tests | Fixed in `5c1fc99` |
| D13 | Every PostgreSQL backup manifest recorded the server version as `unknown` | Not rated | Pipeline tests | Fixed in `3e887e8` |
| D14 | A backup that will be retried is reported `failed` for about 5 seconds before the retry rewrites it | Not rated (candidate) | Pipeline tests | Open: needs a design decision |
| D15 | Renaming a MySQL connection silently changed its engine to PostgreSQL | Data integrity | Code reading during the first batch of fixes, then confirmed at runtime | Fixed in `23eedc4` |
| D16 | Two `connectionId` fields are validated as text, not as UUID | Not rated (candidate) | Code reading during the fixes | Not confirmed: partial checks found no error and one case was inconclusive |
| D17 | Renaming an active scheduled backup cleared its next run time and dropped its schedule | Data and schedule integrity | Code reading during the fix of D15, then confirmed at runtime | Confirmed, waiting for the owner's approval to fix |
| D18 | Partial updates may accept `null` for required fields | Not rated (candidate) | Code reading during the fixes | Not confirmed, waiting for approval to check |

Summary: 11 fixed (D2, D4, D5, D6, D7, D9, D10, D11, D12, D13, D15), 4 open for a product or design decision (D1, D3, D8, D14), 1 confirmed and waiting for approval (D17) and 2 not confirmed (D16, D18). The number of tests marked as expected failures went from 17 to 4 (only D8 remains).

How every fix was made (test-driven development, TDD: the test is written before the fix):

1. Write a unit test that reproduces the defect and watch it fail (red). For D2, a container setting, the failing check was the test environment itself refusing to start.
2. Fix the code and watch the test pass (green).
3. Turn the matching Playwright test from `test.fail` into a normal test, or add a new one.
4. Run the package's unit tests, the type checker and the linter, then rebuild the Docker environment and run the whole Playwright suite.
5. Mutation check: put the old, defective code back and confirm that the new tests fail, then restore the fix. This proves the tests really detect the defect.

| Defect | Fix commit | Mutation check (old code restored) |
|--------|------------|------------------------------------|
| D6 | `7cb0f2c` | 5 of 18 repository tests failed |
| D12 | `5c1fc99` | 5 of 13 request-validation tests failed |
| D7 | `de1557a` | 16 of 114 tests over 8 controllers failed |
| D13 | `3e887e8` | 1 of 37 tests failed |
| D4 | `83627f6` | The 2 new guard tests failed |
| D5 | `ab7152c` | 3 of 11 log-level tests failed (with a stand-in that enables every level) |
| D11 | `00b4e11` | 3 of 6 sign-in page tests failed |
| D9 | `4741c9d` | 5 of 18 route tests failed (with the catch-all route renamed) |
| D10 | `999b710` | 1 of 3 connection page tests failed |
| D2 | `7dadbc2` | Before the fix the test environment refused to start with `envault-e2e-web-1 is unhealthy` |
| D15 | `23eedc4` | 3 of 36 connection tests failed, and 1 of 8 repository tests |

Why some defects stay open: D1 depends on which PostgreSQL versions EnVault decides to support (the test environment uses PostgreSQL 18 and a dedicated test runs D1 against PostgreSQL 16); D3 is the hard-coded default of the sign-in library, and making it configurable is a security design choice; D8 depends on whether those screens are meant for regular users at all (if they are admin-only, the fix is to hide them); D14 depends on how a job that is about to be retried should be reported. D17 was confirmed after the approved list of fixes was closed and waits for the owner's approval; D16 and D18 are suspicions from reading the code that have not been proven. The tests of D1 and D8 are kept in the suite so that the run changes state when they are fixed. Details are in [e2e-testing.md](e2e-testing.md#known-defects).

---

## 8. White-box coverage

Code coverage is the share of the code that the unit tests actually execute: statements (instructions), branches (each outcome of an `if`, a `switch` or a logical operator), functions and lines. EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases) measures it with `pnpm test:coverage` over its three packages: the API (Jest, with the Istanbul counter) and the web app and landing page (Vitest, with the V8 counter). The baseline was taken on 2026-10-13 (commit `e1612c4`), before any defect fix; the second measurement on 2026-10-14 (commit `23eedc4`), after the eleven fixes. Each fix added unit tests.

| Package | Tests before → after | Statements | Branches | Functions | Lines |
|---------|----------------------|-----------:|---------:|----------:|------:|
| API | 365 → 548 | 52.9% → 61.14% | 40.89% → 43.8% | 38.04% → 49.49% | 52.93% → 61.18% |
| Web app | 171 → 202 | 26.44% → 33.29% | 27.28% → 31.79% | 24.05% → 30.77% | 27.91% → 34.91% |
| Landing page | 42 → 42 | 10.19% → 10.19% | 7.88% → 7.88% | 26.78% → 26.78% | 10% → 10% |

The numbers are deterministic (a repeated run gave identical results), and the clean-clone run of 2026-10-15 reproduced the "after" figures for statements and lines exactly.

What the numbers mean: about six tenths of the API code, a third of the web app and a tenth of the landing page run under unit tests. The landing page was not touched by the fixes, so it did not change.

What they do not mean:

- Coverage says which code ran, not whether it behaved correctly. In the baseline, the line behind D12 ran 18 times under unit tests and still hid the defect, because every test supplied the input that avoids it.
- The two counters count differently, so a package should be compared with its own history, not with another package.
- The landing page figure leaves out its 22 `.astro` files, which Vitest does not measure, and four API integration test files that need a live database were skipped, so the repositories they test are under-counted.
- In the baseline the least-covered areas were the MySQL restore strategy (0% of lines), the connections module of the API (14% of lines) and several whole screens of the web app (cleanup, users, connections, cron jobs at 0% to 6%).

The black-box suite found defects that coverage could not show: D6 lived in a module whose service and controller had no unit test, and the line behind D13 had never run under unit tests. The two kinds of testing complement each other. Full tables, per area and per file, are in [testing-coverage.md](testing-coverage.md).

---

## 9. Performance results

The performance suite of EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases) times backups and restores, the job queue, page loads and API responses against the hermetic Docker environment, with object storage provided by MinIO on the same machine. The reference run used here was taken on 2026-10-13 (UTC) at commit `490f42eba8` plus the then-uncommitted performance-suite work (later committed as `235b64d`). That is before the defect fixes and before the MySQL binary log was turned off in the test environment; this report makes no claim about whether those changes affect the figures.

How to read the figures:

- n is the number of measured repetitions; the first repetition of every case is a warm-up and is left out.
- p50 is the median: half of the repetitions were faster. p95 is the 95th percentile: 95% of them were at or below it. With fewer than 20 repetitions p95 is close to the maximum.
- Duration is the time the job took once started; queue wait is the time between the request and the start of the job. Throughput is the database size divided by the duration, in MiB per second (1 MiB = 1,048,576 bytes).

| Reference run environment | Value |
|---------------------------|-------|
| Host | Windows 11 x64, AMD Ryzen 7 7700X3D (16 threads), 31.7 GiB |
| Docker virtual machine | 16 CPUs, 15.5 GiB, Docker 29.8.2 |
| Software | Node.js 24.21.0, Playwright 1.63.0, Chromium 153.0.8010.12 |
| Databases | PostgreSQL 18.6, MySQL 8.0.46 |
| Object storage | MinIO on the same Docker virtual machine (not Cloudflare R2) |

The datasets are three linked tables (customers, 4 orders per customer, 4 events per order) generated inside each database with indexes and foreign keys; the event data looks random so that the dumps do not compress away.

| Engine | Size | Rows (customers / orders / events) | Database (MiB) | Dump, p50 (MiB) |
|--------|------|------------------------------------|---------------:|----------------:|
| PostgreSQL | small | 1,500 / 6,000 / 24,000 | 10.2 | 4.2 |
| PostgreSQL | medium | 15,000 / 60,000 / 240,000 | 99.4 | 41.9 |
| PostgreSQL | large | 75,000 / 300,000 / 1,200,000 | 496.3 | 209.6 |
| MySQL | small | 1,500 / 6,000 / 24,000 | 10.1 | 8.0 |
| MySQL | medium | 15,000 / 60,000 / 240,000 | 94.7 | 81.2 |
| MySQL | large | 75,000 / 300,000 / 1,200,000 | 463.1 | 408.7 |

Backup and restore, one job at a time:

| Engine | Size | n | Backup p50 (s) | Backup p95 (s) | Backup MiB/s (p50) | Restore p50 (s) | Restore p95 (s) | Restore MiB/s (p50) |
|--------|------|--:|---------------:|---------------:|-------------------:|----------------:|----------------:|--------------------:|
| PostgreSQL | small | 20 | 0.29 | 0.30 | 35.2 | 0.18 | 0.18 | 57.6 |
| PostgreSQL | medium | 20 | 1.85 | 2.02 | 53.9 | 1.01 | 1.15 | 98.4 |
| PostgreSQL | large | 10 | 8.73 | 9.14 | 56.9 | 4.74 | 4.93 | 104.7 |
| MySQL | small | 20 | 0.14 | 0.15 | 70.5 | 0.91 | 0.93 | 11.1 |
| MySQL | medium | 20 | 0.80 | 0.82 | 118.2 | 4.14 | 4.28 | 22.9 |
| MySQL | large | 10 | 3.70 | 3.80 | 125.2 | 19.86 | 20.65 | 23.3 |

When a job is alone, the median queue wait is 5 ms for a backup and 2 ms for a restore. The suite checks that every restored table has the same row count as its source, and no case failed. The slowest step is the MySQL restore, about 23 MiB/s against about 125 MiB/s for the MySQL backup; relaxing the database's disk-flush settings changed it by only about 5%, so disk flushing is not what limits it.

The queue: EnVault runs at most 2 backups and 1 restore at the same time. To show this, K backups of K different connections (medium dataset) were requested together. The makespan is the time from the first request to the last completion.

| Simultaneous backups (K) | PostgreSQL makespan p50 (s) | PostgreSQL queue wait by start order, median (s) | MySQL makespan p50 (s) |
|-------------------------:|----------------------------:|--------------------------------------------------|-----------------------:|
| 1 | 1.92 | 0.01 | 0.87 |
| 2 | 1.99 | 0.01, 0.01 | 0.97 |
| 4 | 4.11 | 0.01, 0.01, 2.03, 2.04 | 2.00 |
| 6 | 6.28 | 0.01, 0.01, 2.07, 2.10, 4.10, 4.15 | 3.04 |

The wait climbs one step (about one backup) every two jobs, which is the concurrency of 2 seen from outside. Of two simultaneous restores, the second waited 1.08 s on PostgreSQL and 4.49 s on MySQL, the duration of one restore, which confirms that restores run one at a time.

Pages, opened cold in Chromium (a new browser profile for every load). FCP (first contentful paint) is when the first content appears; LCP (largest contentful paint) is when the main content appears.

| Page | Window | n | Load p50 (ms) | FCP p50 (ms) | LCP p50 (ms) | LCP p95 (ms) | Transferred (KiB) | Requests |
|------|--------|--:|--------------:|-------------:|-------------:|-------------:|------------------:|---------:|
| Login | 1000x800 | 20 | 46 | 380 | 416 | 420 | 498 | 48 |
| Login (animated panel) | 1280x720 | 10 | 51 | 386 | 386 | 396 | 498 | 48 |
| Dashboard | 1280x720 | 20 | 50 | 140 | 488 | 584 | 625 | 56 |
| Connections | 1280x720 | 20 | 48 | 132 | 428 | 456 | 500 | 49 |

API latency, 100 sequential requests per endpoint through the web proxy, measured by the client until the whole body was read:

| Endpoint | p50 (ms) | p95 (ms) | p99 (ms) | Rows in the answer |
|----------|---------:|---------:|---------:|-------------------:|
| `GET /api/connections` | 3.4 | 4.3 | 6.2 | 0 |
| `GET /api/jobs/summary` | 3.4 | 4.0 | 8.1 | - |
| `GET /api/jobs/analytics/daily?window=7` | 3.9 | 4.7 | 6.3 | 7 |
| `GET /api/backups/history` | 4.9 | 5.6 | 6.0 | 264 |

Repeatability of the measurements: two full runs during development agreed within 4% on the median throughput, within 0.7% on the PostgreSQL backup duration and within 12% on the queue makespans. A full run takes about 17 minutes; it is started with `pnpm test:e2e:perf` and writes `results.json`, `summary.csv` and `summary.md` to a new folder under `e2e/perf-results/`. The full method is in [e2e-testing.md](e2e-testing.md#performance-suite).

---

## 10. Reliability evidence

A test suite is only useful if its result can be trusted: a red run must mean a real problem, and a green run must not be luck. A flaky test is one that passes or fails on the same code without any change, usually because of timing, shared data or the order of the tests. To measure this, the whole Playwright functional suite of EnVault (256 tests: API, browser and backup/restore) was run 13 times in a row on 2026-10-15, at commit `9902fee`, against one hermetic Docker environment started once with `pnpm docker:e2e` (24.9 s with images already built). Retries are set to 0 on purpose: Playwright can rerun a failed test automatically, which would hide a flaky test, so here a single failure turns the run red. By default Playwright used 8 workers (parallel processes) on this machine.

| Run | Command | Why this variation | Result | Playwright time |
|-----|---------|--------------------|--------|-----------------|
| 1-10 | `pnpm test:e2e`, 10 times in a row | Normal use; the same data store is reused by every run, so leftovers from one run would break the next | Each: 255 passed, 1 skipped, 0 failed | 29.8, 26.0, 25.9, 25.9, 24.7, 24.8, 25.4, 25.9, 25.7, 25.6 s |
| 11 | `pnpm test:e2e --workers=1` | One test at a time, in a fixed order: exposes tests that only pass because another test ran first or in parallel | 255 passed, 1 skipped | 1.9 min |
| 12 | `pnpm test:e2e --workers=16` | Twice the default parallelism: exposes tests that collide on shared data or depend on timing | 255 passed, 1 skipped | 25.8 s |
| 13 | `pnpm test:e2e --repeat-each=3` | Every test three times in the same run: exposes tests that fail now and then | 766 tests (the sign-in step once, plus 3 x 255), 763 passed, 3 skipped | 1.1 min |

Totals: 13 runs, 3838 test executions, 3823 passed, 15 skipped by design, 0 failures, 0 flaky tests. The skipped test is always the same one: the D1 check, which only runs when the source PostgreSQL is older than 17. The 4 tests of defect D8 are marked `test.fail` (expected to fail) and Playwright counts them as passed while the defect exists. The first run was the slowest because its caches were cold. With 16 workers the suite was not faster than with 8, so at 8 workers its time is no longer limited by the number of workers; the point of that run was to show that more parallel pressure causes no failures. After the study the environment was removed with `pnpm docker:e2e:down` and 0 containers, volumes and networks remained.

What this shows: the results do not depend on the order of the tests, on parallelism or on repetition, and the tests clean up after themselves, since 13 runs shared one environment without interfering. This agrees with the history of the work: during development the full suite had already passed more than 30 consecutive full runs with identical counts, and every defect fix was mutation-checked (the old code restored, the new tests seen failing, the fix restored).

Second check, a clean clone (2026-10-15, 13:55 to 14:00, UTC-6): to test that the repository and its documentation are enough on their own, the branch was cloned with `git clone --branch feat/e2e-playwright-suite` into a new folder and the "Quick path" of [e2e-testing.md](e2e-testing.md) was followed literally.

| Step | Command | Outcome | Time |
|------|---------|---------|------|
| 1 | `cp .env.e2e.example .env.e2e` | Done | under 1 s |
| 2 | `pnpm install` | Done | 27.6 s |
| 3 | `pnpm e2e:install` | Done (Chromium was already on the machine) | 1.0 s |
| 4 | `pnpm docker:e2e` | Environment healthy | 80.8 s |
| 5 | `pnpm test:e2e` | 255 passed, 1 skipped | 26.2 s |
| 6 | `pnpm docker:e2e:down` | Done; 0 containers, volumes and networks left | 2.5 s |
| - | `pnpm test` | API: 61 test files passed and 4 skipped (they need a live database), 548 tests passed and 32 skipped; web app: 38 files passed; landing page: 4 files passed | 56.3 s |
| - | `pnpm test:coverage` | API 61.14% of statements and 61.18% of lines; web app 33.29% and 34.91%; landing page 10.19% and 10%, identical to the documented figures | 59.6 s |

No documented step was wrong. The limit of this check: it ran on the same physical machine, so the package store, the Chromium download and the Docker base images were already present. It proves that the repository plus its documentation are self-sufficient, not what a first installation on a new machine costs (a first `pnpm docker:e2e` build took about 3 minutes, 194.5 s, earlier in the project).

---

## 11. Limitations and threats to validity

The results of this QA work on EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases, tested with Playwright, Jest and Vitest) hold under the conditions listed here. A threat to validity is a reason a result might not hold elsewhere.

| Limitation | Consequence |
|------------|-------------|
| One machine, a Windows host | Every result comes from one Windows 11 computer with Docker Desktop. Linux or macOS hosts, and slower machines, were not tried. |
| Chromium only | Firefox and WebKit (Safari) were not tested, and neither were mobile screen sizes. |
| No CI yet | The suite runs on a developer machine; nothing runs it automatically on every change. |
| MinIO instead of Cloudflare R2 | Storage behavior specific to R2 and the network trip to it are not covered; the performance figures exclude that trip. |
| Performance measured before the fixes | The reference run predates the eleven defect fixes and the change that turned off the MySQL binary log. It was not repeated afterwards. |
| One performance reference run | The figures come from one full run (with a second one used only to check repeatability) on one machine; they are reference values, not guarantees. |
| D8 still expected to fail | Four tests document an open defect instead of checking working behavior. |
| Clean clone on a warm machine | The clean-clone check reused caches already on the machine, so it does not measure a first installation. |
| No load or stress testing | The behavior with many simultaneous users was not tested; the queue test used at most 6 simultaneous backups. |
| No accessibility or visual tests | Screen-reader support, contrast and visual regressions were not checked. |
| The tests are new code | The test code itself has had limited independent review; some test-helper improvements suggested by an automated review are still pending. |
| Coverage tables partly old | The per-area and per-file coverage tables are from the baseline; only the totals were measured again after the fixes. |

---

## 12. How to reproduce

Every result in this QA report on EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases) can be reproduced from the repository with the commands below, run from its root. Requirements: Node.js 22 or newer, pnpm 10 or newer, Docker with Compose, and the ports 5173, 3000, 5435, 3307, 9000 and 9001 free.

| Goal | Commands |
|------|----------|
| Prepare once | `cp .env.e2e.example .env.e2e`, `pnpm install`, `pnpm e2e:install` |
| Start the test environment | `pnpm docker:e2e` |
| Run the functional suite | `pnpm test:e2e` (expected: 255 passed, 1 skipped) |
| Repeat the reliability study | `pnpm test:e2e` ten times, then `pnpm test:e2e --workers=1`, `pnpm test:e2e --workers=16` and `pnpm test:e2e --repeat-each=3` |
| Open the HTML report of the last run | `pnpm test:e2e:report` |
| Run the performance suite | `pnpm test:e2e:perf` (about 17 minutes; results in `e2e/perf-results/`) |
| Stop and delete the environment | `pnpm docker:e2e:down` |
| Unit tests and coverage (no Docker needed) | `pnpm test`, `pnpm test:coverage` |

Full instructions, the variants of each command and the troubleshooting table are in [e2e-testing.md](e2e-testing.md) and [testing-coverage.md](testing-coverage.md).

---

## 13. Conclusions and next steps

Conclusions of the QA work on EnVault (a self-hosted application that backs up and restores PostgreSQL and MySQL databases), tested with a Playwright black-box suite and the existing Jest and Vitest unit tests:

- Playwright was enough to cover the API, the browser interface and the whole backup and restore path with one tool, and to measure performance with the same tool.
- The black-box suite found 18 defects; 11 were fixed with a test written first, among them one security defect (D6), one safety defect (D12) and one data-integrity defect (D15); D6 and D12 were in code that the unit tests did not reach or did not run with the input that breaks it.
- The suite proved stable: 3838 test executions in 13 runs with different parallelism and repetition, 0 failures and 0 flaky tests, and the same result from a clean clone.
- The fixes raised unit-test coverage of the API from 52.93% to 61.18% of lines and of the web app from 27.91% to 34.91%.
- The performance reference shows backups of a 500 MiB database in under 9 s and makes visible the slowest step, the MySQL restore (about 23 MiB/s).

Next steps:

1. Run the suite in CI on every change, ideally on Linux, to remove the single-machine limitation.
2. Decide on the open defects D1, D3, D8 and D14, and approve or reject the fix of D17 and the checks of D16 and D18.
3. Repeat the performance run on the current code, and once against a real Cloudflare R2 bucket.
4. Extend the browser tests to Firefox and WebKit, and add accessibility checks.
5. Add unit tests where the baseline coverage was weakest: the MySQL restore strategy, the connections module and the web screens for cleanup, users and cron jobs.
