# White-box Testing and Coverage — EnVault Management

> 🇪🇸 Versión en español: [../es/testing-coverage.md](../es/testing-coverage.md)

White-box testing looks inside the code: the tests are written knowing how the program is built, and a coverage tool reports which statements, branches and functions they actually ran. EnVault measures it on its unit suites (Jest in `apps/api`, Vitest in `apps/web` and `apps/landing`) with one command, `pnpm test:coverage`. It is the counterpart of the black-box E2E suite described in [e2e-testing.md](e2e-testing.md).

The coverage results, together with the rest of the QA evidence, are summarised in the [QA report](qa-report.md).

---

## Quick path

| # | Command | What it does |
|---|---------|--------------|
| 1 | `pnpm install` | Installs the workspace, including the Vitest coverage plugin. Once. |
| 2 | `pnpm test:coverage` | Runs the unit suites of the three packages with coverage (about 20 s with a warm Jest cache, 45 s with a cold one), prints a four-line summary per package and writes the reports. |
| 3 | Open `apps/api/coverage/index.html` in a browser | The HTML report. `apps/web/coverage` and `apps/landing/coverage` hold the same files. |

No Docker and no database are needed. `pnpm test` is unchanged and never measures coverage.

---

## Baseline

Measured on 2026-10-13 with the source and tests of commit `e1612c4`, on Node.js 24.21.0, pnpm 10.30.0 and Windows 11. The numbers are deterministic: a second run gave a byte-identical `coverage-summary.json` for each package. Each cell is the percentage with covered / total in brackets; percentages are truncated to two decimals, as Istanbul reports them.

| Package | Runner and provider | Tests | Statements | Branches | Functions | Lines |
|---------|---------------------|-------|-----------:|---------:|----------:|------:|
| `apps/api` | Jest 30.4.2, Istanbul (`babel`) | 55 suites passed + 4 skipped; 365 tests passed + 32 skipped | 52.9% (1846 / 3489) | 40.89% (456 / 1115) | 38.04% (226 / 594) | 52.93% (1723 / 3255) |
| `apps/web` | Vitest 4.1.8, V8 | 33 files, 171 tests | 26.44% (706 / 2670) | 27.28% (574 / 2104) | 24.05% (223 / 927) | 27.91% (676 / 2422) |
| `apps/landing` | Vitest 4.1.11, V8 | 4 files, 42 tests | 10.19% (52 / 510) | 7.88% (19 / 241) | 26.78% (15 / 56) | 10% (49 / 490) |

How to read it: roughly half of the API code is executed by its unit tests, a quarter of the web app and a tenth of the landing page. Those are low-to-middling figures, and the sections below show where the gaps are. Two cautions apply before comparing rows: Istanbul and V8 count differently (see [How the numbers are produced](#how-the-numbers-are-produced)), so compare a package with its own history, not with another package; and the landing figure leaves out its 22 `.astro` files (see [Excluded from the measurement](#excluded-from-the-measurement)).

---

## After the defect fixes

Measured twice, on the same Node.js, pnpm and operating system as the baseline: on 2026-10-14 with the source and tests of commit `23eedc4`, the branch after the first eleven defect fixes found by the E2E work, and on 2026-10-15 with commit `60fe003`, after two more fixes (D17, a cronjob update that dropped the cronjob from the scheduler, and D18, `null` accepted for required fields of a partial update). Each fix was written test first and added unit tests, so each cell reads baseline → after eleven fixes → after thirteen, and the bracket is the change from the baseline in percentage points (pp).

| Package | Tests (baseline → 11 fixes → 13 fixes) | Statements | Branches | Functions | Lines |
|---------|----------------------------------------|-----------:|---------:|----------:|------:|
| `apps/api` | 365 → 548 → 585 tests; 55 → 61 → 63 suites | 52.9% → 61.14% → 62.32% (+9.42 pp) | 40.89% → 43.8% → 45.25% (+4.36 pp) | 38.04% → 49.49% → 51.17% (+13.13 pp) | 52.93% → 61.18% → 62.43% (+9.5 pp) |
| `apps/web` | 171 → 202 → 202 tests; 33 → 38 → 38 files | 26.44% → 33.29% → 33.29% (+6.85 pp) | 27.28% → 31.79% → 31.79% (+4.51 pp) | 24.05% → 30.77% → 30.77% (+6.72 pp) | 27.91% → 34.91% → 34.91% (+7 pp) |
| `apps/landing` | 42 → 42 → 42 tests; 4 → 4 → 4 files | 10.19% → 10.19% → 10.19% (0 pp) | 7.88% → 7.88% → 7.88% (0 pp) | 26.78% → 26.78% → 26.78% (0 pp) | 10% → 10% → 10% (0 pp) |

At `60fe003` the API figures are statements 2187 / 3509, branches 510 / 1127, functions 305 / 596 and lines 2044 / 3274.

Where the gain comes from: the API gained specs for the connections controller (it had none), the restore request DTO, the UUID validation of 20 routes, the PostgreSQL manifest snapshot, the log levels and the connection DTOs and partial update; then, with D17 and D18, two new suites (the cronjobs repository and the cronjob update DTO) and more cases in the cronjobs service and connection update DTO specs. The web app gained tests for the login page, the route table (including the new not-found screen), the connections page and the dashboard API module; D17 and D18 did not touch it. The landing page was not touched by the fixes, so it did not change. More executed lines is still not proof of correctness: line 535 of `restore.service.ts` ran 18 times in the baseline and still hid a defect (see [Coverage by area](#coverage-by-area) and [e2e-testing.md](e2e-testing.md)). The per-area tables and the least-covered lists below were produced from the baseline and have not been re-measured: run `pnpm test:coverage` to refresh them.

---

## What white-box testing is

In white-box testing (also called structural or glass-box testing) the tester sees the source and designs tests from its structure: which statements, decisions and functions exist, and whether each one has been exercised. Coverage is the measure: the share of those structural elements that ran during the tests. It answers "which code did no test reach?", never "is the behavior correct?".

| Metric | What it counts | Technique it supports | Note |
|--------|----------------|-----------------------|------|
| Statement | Executable statements that ran at least once | Statement testing | The weakest criterion: `if (x) { a() }` is 100% covered by a test where `x` is true, even though the false case was never tried. |
| Branch | Every outcome of every decision (`if`, `else`, `?:`, `switch` case, an operand of `&&`, `\|\|` or `??`) taken at least once | Branch (decision) testing | The most useful metric here: it shows the cases a test forgot. |
| Function | Functions and methods called at least once | Function (method) testing | Shows code that nothing calls under test. |
| Line | Physical source lines with at least one executable statement that ran | A line-based view of statement testing | Differs from statements when a line holds several statements or one statement spans lines. |
| Path | Every distinct route through a function across its decisions | Path testing | **Not measured.** The number of paths grows exponentially with the decisions and the tools do not report it. Full branch coverage does not imply path coverage. |

Condition-level criteria (condition/decision and MC/DC coverage) are not measured either; the branch figure counts each operand of a logical expression as a branch, which is close to condition coverage but not the same thing.

---

## What the suites cover

| Package | Runner | Files | Tests | What they test |
|---------|--------|-------|-------|----------------|
| `apps/api` | Jest 30 with ts-jest, Node environment | 63 run, 4 skipped | 585 passed, 32 skipped | Services, repositories, controllers, queue processors, backup and restore strategies, middleware and interceptors, sanitization, configuration and three migrations, always with the database, Redis and object storage mocked. The 4 skipped files need a live database (see [Excluded from the measurement](#excluded-from-the-measurement)). |
| `apps/web` | Vitest 4 with jsdom and Testing Library | 38 | 202 | Shared UI components, hooks and providers, plus parts of the audit, cron jobs, dashboard, dumps and restore screens, the login page, the route table and the connections page. |
| `apps/landing` | Vitest 4, Node environment | 4 | 42 | Pure logic of the documentation section: content, syntax highlighting, content resolution and link fragments. |

The counts are those of commit `60fe003`; the baseline had 55 API suites with 365 tests and 33 web files with 171 tests (see [Baseline](#baseline)).

---

## How to run it

| Scope | Command | Output |
|-------|---------|--------|
| All three packages | `pnpm test:coverage` (repository root) | The three runs in parallel, each with its own summary. |
| API | `pnpm --filter @vaultly-control/api test:coverage` | `apps/api/coverage/` |
| Web app | `pnpm --filter @vaultly-control/web test:coverage` | `apps/web/coverage/` |
| Landing page | `pnpm --filter @vaultly-control/landing test:coverage` | `apps/landing/coverage/` |
| Tests only, no coverage | `pnpm test` | No `coverage` folder. |

Each package writes the same set of files into its `coverage/` folder, which is git-ignored:

| File | Content |
|------|---------|
| `index.html` and one page per source file | The browsable report (see [Reading the HTML report](#reading-the-html-report)). |
| `lcov.info` | Line, function and branch records in the LCOV format, for editors and CI services. On Windows the file paths use backslashes. |
| `coverage-summary.json` | Totals and one entry per file, for scripts. |

Files that no test reaches are not skipped: Jest lists every `src/**/*.ts` file with executable code and Vitest every file under `src/**`, so untested code shows up as 0% instead of disappearing. To list the API files in which no line ran:

```bash
node -e "const s=require('./apps/api/coverage/coverage-summary.json');for(const[f,v]of Object.entries(s))if(f!=='total'&&v.lines.total>0&&v.lines.covered===0)console.log(f)"
```

Run it from the repository root after `pnpm test:coverage`; change the package folder for the other two.

### How the numbers are produced

| Package | Provider | How it counts |
|---------|----------|---------------|
| `apps/api` | Istanbul (`coverageProvider: 'babel'`, the Jest default, stated in the config) | Instruments the code and counts real statements, branches and functions. On this suite it is about 3 times faster than the `v8` provider with a cold Jest cache (41 to 48 s against 114 to 135 s) and more than 4 times faster with a warm one (14 to 19 s against 65 to 89 s), and `v8` reports ranges rather than statements: 10,326 "statements" against 3,489 and an inflated 73% of branches. |
| `apps/web`, `apps/landing` | V8 (`@vitest/coverage-v8`) | Reads the coverage V8 records while the tests run and converts it to Istanbul's statements, branches and functions. `@vitest/coverage-v8` is pinned to the exact Vitest version of each package (4.1.8 and 4.1.11). |

---

## Reading the HTML report

Open `coverage/index.html`. The first page lists folders with the four metrics; click a column to sort, a folder to go down, and a file to see its source. The colors follow the Istanbul defaults: red below 50%, yellow from 50% to 80%, green from 80%.

| In a file page | Meaning |
|----------------|---------|
| Green margin with a count (`7x`) | How many times that line ran. |
| Pink margin with no count | The line never ran. |
| Pink background on code | A statement that never ran, or a function that was never called (its name is highlighted). |
| Dark badge `I` or `E` before an `if` | The `if` path (`I`) or the `else` path (`E`) was never taken. |
| Yellow background on an operand of `?:`, `&&`, `\|\|`, `??` or a `switch` case | That side of the expression was never evaluated. |

A worked example from the baseline: open `apps/api/coverage/src/modules/restore/restore.service.ts.html` and find `if (targetEnvironment === Environment.PROD)`. The line ran 7 times and carries the `I` badge, so the branch that refuses a restore into a production connection was never taken by any unit test; only the E2E suite (`rules.pipeline.spec.ts`) checks it. In `lcov.info` the same fact reads `BRDA:125,4,0,0` (line 125, block 4, branch 0, taken 0 times) next to `BRDA:125,4,1,7` (the other branch, taken 7 times). A second example: in `apps/web/src/lib/format.ts` line 3 chooses the locale with a ternary, and only the `'es-AR'` side ever ran (62 times; the `'en-US'` side, 0).

---

## Least-covered files

Ranked by uncovered lines (lines that never ran), the 15 files that leave the most code unexecuted in each package. "Branches covered" is the share of decision outcomes taken.

### API

| # | File | Uncovered lines | Lines covered | Branches covered |
|--:|------|----------------:|--------------:|-----------------:|
| 1 | `src/modules/backup/strategies/mysql-restore.strategy.ts` | 154 | 0% (0/154) | 0% (0/44) |
| 2 | `src/modules/restore/restore.service.ts` | 131 | 56.76% (172/303) | 43.35% (62/143) |
| 3 | `src/modules/maintenance/maintenance.service.ts` | 129 | 54.89% (157/286) | 36.92% (48/130) |
| 4 | `src/modules/cronjobs/cronjobs.service.ts` | 105 | 44.44% (84/189) | 21.42% (18/84) |
| 5 | `src/modules/backup/backup.service.ts` | 82 | 71.32% (204/286) | 58.15% (82/141) |
| 6 | `src/modules/connections/connections.service.ts` | 63 | 12.5% (9/72) | 0% (0/26) |
| 7 | `src/modules/backup/r2.service.ts` | 50 | 42.52% (37/87) | 30.23% (13/43) |
| 8 | `src/modules/jobs/jobs.repository.ts` | 49 | 14.03% (8/57) | 0% (0/44) |
| 9 | `src/modules/backup/backup.repository.ts` | 37 | 47.88% (34/71) | 47.61% (20/42) |
| 10 | `src/modules/connections/connections.controller.ts` | 35 | 0% (0/35) | n/a |
| 11 | `src/modules/cronjobs/cronjobs.controller.ts` | 35 | 0% (0/35) | n/a |
| 12 | `src/modules/backup/backup.module.ts` | 30 | 0% (0/30) | n/a |
| 13 | `src/app.module.ts` | 29 | 0% (0/29) | n/a |
| 14 | `src/connections/seeds/initial-connections.seed.ts` | 29 | 0% (0/29) | 0% (0/18) |
| 15 | `src/auth/seeds/admin.seed.ts` | 26 | 0% (0/26) | 0% (0/14) |

### Web app

| # | File | Uncovered lines | Lines covered | Branches covered |
|--:|------|----------------:|--------------:|-----------------:|
| 1 | `src/features/cleanup/hooks/useConnectionRetention.ts` | 107 | 0% (0/107) | 0% (0/57) |
| 2 | `src/features/connections/index.tsx` | 72 | 0% (0/72) | 0% (0/31) |
| 3 | `src/features/connections/components/ConnectionForm.tsx` | 70 | 0% (0/70) | 0% (0/80) |
| 4 | `src/features/restore/hooks/useRestore.ts` | 59 | 0% (0/59) | 0% (0/18) |
| 5 | `src/features/cronjobs/hooks/useCronjobForm.ts` | 54 | 0% (0/54) | 0% (0/28) |
| 6 | `src/features/cronjobs/index.tsx` | 54 | 0% (0/54) | 0% (0/39) |
| 7 | `src/features/users/hooks/useUsers.ts` | 54 | 0% (0/54) | 0% (0/25) |
| 8 | `src/features/dumps/index.tsx` | 53 | 0% (0/53) | 0% (0/48) |
| 9 | `src/lib/format.ts` | 49 | 19.67% (12/61) | 20.33% (12/59) |
| 10 | `src/features/cleanup/hooks/useMaintenance.ts` | 46 | 0% (0/46) | 0% (0/27) |
| 11 | `src/shared/ui/filters.tsx` | 40 | 61.53% (64/104) | 46.29% (25/54) |
| 12 | `src/features/dumps/components/DumpActions.tsx` | 39 | 0% (0/39) | 0% (0/18) |
| 13 | `src/features/cronjobs/lib/cron-validator.ts` | 37 | 0% (0/37) | 0% (0/33) |
| 14 | `src/shared/hooks/useSSE.ts` | 34 | 0% (0/34) | 0% (0/4) |
| 15 | `src/features/cleanup/components/RetentionDialog.tsx` | 33 | 0% (0/33) | 0% (0/62) |

### Landing page

Only 11 of its 15 files with code have any uncovered line.

| # | File | Uncovered lines | Lines covered | Branches covered |
|--:|------|----------------:|--------------:|-----------------:|
| 1 | `src/components/ui/AsciiGardenCanvas.tsx` | 380 | 0% (0/380) | 0% (0/153) |
| 2 | `src/features/documentation/components/DocumentationSection.tsx` | 19 | 0% (0/19) | 0% (0/49) |
| 3 | `src/components/ui/card.tsx` | 18 | 0% (0/18) | n/a |
| 4 | `src/lib/api-config.ts` | 8 | 0% (0/8) | 0% (0/10) |
| 5 | `src/components/ui/saa-s-template.tsx` | 7 | 0% (0/7) | 0% (0/5) |
| 6 | `src/features/documentation/lib/highlight.ts` | 3 | 90.32% (28/31) | 91.66% (11/12) |
| 7 | `src/features/i18n/get-dictionary.ts` | 2 | 0% (0/2) | 0% (0/3) |
| 8 | `src/features/documentation/lib/resolve-content.ts` | 1 | 94.11% (16/17) | 88.88% (8/9) |
| 9 | `src/features/i18n/dictionaries/en.ts` | 1 | 0% (0/1) | n/a |
| 10 | `src/features/i18n/dictionaries/es.ts` | 1 | 0% (0/1) | n/a |
| 11 | `src/lib/utils.ts` | 1 | 0% (0/1) | n/a |

### Files where no line ran

| Package | Files at 0% of lines | Uncovered lines inside them | What they are |
|---------|---------------------:|----------------------------:|---------------|
| `apps/api` | 38 of 120 | 622 of 1,532 (41%) | 12 Nest modules (`*.module.ts`, `app.module.ts`), 7 DTOs, 6 controllers, 3 configuration files, 2 seeds, `mysql-restore.strategy.ts`, `audit.service.ts` and 6 small files (an exception filter, a guard, an interceptor, a decorator, an entity, an enum). |
| `apps/web` | 80 of 145 | 1,388 of 1,746 (80%) | Whole screens and what hangs from them (components, hooks, API clients) for connections, cron jobs, dumps, users, cleanup, the login page and most of the dashboard. |
| `apps/landing` | 9 of 15 | 437 of 441 (99%) | `AsciiGardenCanvas.tsx` alone is 380 lines; the rest are small UI and i18n files. |

---

## Coverage by area

### API

Folder by folder, ordered by uncovered lines. A "file" here is a file with executable code; type-only files do not appear in the Jest report.

| Area | Files | Statements | Branches | Functions | Lines | Uncovered lines |
|------|------:|-----------:|---------:|----------:|------:|----------------:|
| `modules/backup` | 15 | 53.38% | 42.73% | 32.02% | 53.49% | 439 |
| `modules/cronjobs` | 8 | 30.57% | 20% | 12% | 30.5% | 205 |
| `modules/restore` | 11 | 62.09% | 47.48% | 48.83% | 62.35% | 198 |
| `modules/maintenance` | 9 | 57.44% | 37.87% | 38.15% | 58.18% | 166 |
| `modules/connections` | 8 | 15.87% | 20% | 9.3% | 14.36% | 149 |
| `modules/jobs` | 11 | 58.6% | 16.94% | 46.66% | 57.67% | 91 |
| `common` | 15 | 67.42% | 63.82% | 73.68% | 67.78% | 67 |
| `auth` | 11 | 40.16% | 57.62% | 50% | 40.9% | 65 |
| `modules/audit` | 5 | 51.76% | 56.25% | 41.66% | 52.7% | 35 |
| `connections` (seeds) | 1 | 0% | 0% | 0% | 0% | 29 |
| `app.module.ts` | 1 | 0% | n/a | 0% | 0% | 29 |
| `database` | 16 | 84.32% | 50% | 45.45% | 84.84% | 25 |
| `config` | 4 | 61.29% | 31.57% | 66.66% | 58.62% | 12 |
| `modules/queue` | 1 | 37.5% | 0% | 0% | 28.57% | 10 |
| `shared` | 2 | 71.87% | 72.72% | 85.71% | 75% | 7 |
| `health` | 2 | 68.18% | 100% | 100% | 72.22% | 5 |

What the numbers say, honestly:

- **Better covered, and fine for now.** `common` (68% of lines: encryption, sanitization, pipes and utilities), `shared` (75%) and `health` (72%) are small, mostly pure code and reasonably tested, and the daily-series analytics code in `modules/jobs` is fully covered. `database` shows 85%, but that is mostly entity and enum files that run as soon as a test imports them, so it says little. `modules/jobs` as a whole is at 58% of lines and 17% of branches because `jobs.repository.ts` (14% of lines, 0 of 44 branches) and `jobs.service.ts` (17%) have no spec.
- **Risky because it is uncovered.** The **connections** module (14% of lines; the service 12.5%, the controller and every DTO 0%) creates, updates and deletes the stored database credentials, yet only its repository has a spec: the E2E suite found D6, the password returned by `PATCH /api/connections/:id`, there. The **MySQL restore strategy** (154 lines, 0%) is the only restore engine without a spec, so a regression would surface only as an E2E failure far from its cause. **Cron jobs** (30.5%; the service 44%, 21% of branches) schedule the automatic backups and the watchdog that raises an alert when one is overdue. **Maintenance** and `r2.service.ts` (58% and 43% of lines) delete dumps and apply retention, destructive work with under 40% of branches taken. **Restore** (62%) never takes its production-refusal branch in a unit test (see [Reading the HTML report](#reading-the-html-report)) and never runs its startup recovery of unfinished jobs. **Auth** (41%) leaves `auth.guard.ts`, the session guard the controllers use, and `auth.config.ts` at 0%; only the E2E authorization tables check them.
- **Low on purpose, or covered elsewhere.** The `*.module.ts` files, `app.module.ts` and the seeds only wire dependencies or run at start-up; starting the stack in the E2E suite exercises them. `http-exception.filter.ts` and `transform.interceptor.ts` (the error and success envelopes) are at 0% in unit tests and are checked black-box by `error-envelope.api.spec.ts`.
- **Executed is not verified.** Line 535 of `restore.service.ts` (`getBackupById(dto.sourceBackupId!)`) ran 18 times and still hides D12, because every unit test supplies a source; the line is "covered" and the input that breaks it is not. The line that holds D13 (`backup.service.ts:756`, the PostgreSQL version lookup) ran 0 times: the unit tests build manifests from a canned `serverVersion`, so the defect could not appear.

### Web app

| Area | Files | Statements | Branches | Functions | Lines | Uncovered lines |
|------|------:|-----------:|---------:|----------:|------:|----------------:|
| `features/cleanup` | 11 | 0% | 0% | 0% | 0% | 256 |
| `features/connections` | 8 | 0% | 0% | 0% | 0% | 237 |
| `features/cronjobs` | 9 | 6.09% | 5.46% | 12.94% | 6.4% | 234 |
| `features/restore` | 22 | 33.82% | 32.82% | 24.54% | 34.3% | 203 |
| `features/users` | 11 | 0% | 0% | 0% | 0% | 166 |
| `features/dumps` | 10 | 4.91% | 10.34% | 3.03% | 5.26% | 162 |
| `shared/ui` | 32 | 65.13% | 62.6% | 58.38% | 65.7% | 131 |
| `features/dashboard` | 17 | 12.12% | 10.28% | 11.42% | 13.04% | 100 |
| `features/audit` | 6 | 43.31% | 47.96% | 62.5% | 52% | 60 |
| `shared/hooks` | 5 | 63.75% | 70.68% | 59.37% | 63.82% | 51 |
| `lib` | 1 | 16.66% | 20.33% | 36.36% | 19.67% | 49 |
| `features/auth` | 1 | 0% | 0% | 0% | 0% | 26 |
| `shared/lib` | 5 | 29.26% | 0% | 7.14% | 33.33% | 24 |
| `shared/components` | 10 | 80% | 61.73% | 71.05% | 79.59% | 20 |
| `src` root files | 4 | 32.25% | 80% | 10% | 37.03% | 17 |
| `shared/providers` | 3 | 60% | 50% | 57.14% | 60% | 8 |
| `types` | 1 | 0% | n/a | n/a | 0% | 2 |

Reading: the shared component library (`shared/ui`, `shared/components`, `shared/hooks`) is where the web tests are, at 64% to 80% of lines, and the feature screens are where they are not. Cleanup (retention policies and manual deletion of dumps), users, connections and cron jobs have no unit test at all or almost none (0% to 6%); the E2E UI suite opens every section and drives the connections, login, dashboard and dumps flows, so cleanup, users and cron jobs are the screens whose behavior no suite checks beyond opening them. `src/lib/format.ts` (20% of lines, date and relative-time formatting with a language switch) is a cheap place to add tests. The Files column counts every file Vitest listed, type-only ones included.

### Landing page

| Area | Files | Statements | Branches | Functions | Lines | Uncovered lines |
|------|------:|-----------:|---------:|----------:|------:|----------------:|
| `components/ui` | 3 | 0% | 0% | 0% | 0% | 405 |
| `features/documentation` | 7 | 68.42% | 27.14% | 68.18% | 68.05% | 23 |
| `lib` | 2 | 0% | 0% | 0% | 0% | 9 |
| `features/i18n` | 4 | 0% | 0% | 0% | 0% | 4 |

Reading: 405 of the 441 uncovered lines are three presentational components, mostly `AsciiGardenCanvas.tsx`, a canvas animation that unit tests are poor at checking. The tested logic (`features/documentation`) reaches 68% of lines but only 27% of branches, so its edge cases are the next thing to test. The 10% total is a statement about TypeScript files only; the Astro files are not measured.

---

## Excluded from the measurement

| What | Why | Effect of including it |
|------|-----|------------------------|
| Test files and test helpers (`*.spec.ts`, `*.test.ts(x)`, `src/test/**` in the web app) | Tests are not the product. | None. |
| `apps/api/src/main.ts` (48 lines) | Process entry point: bootstraps Nest and listens on a port. | Adds 0 covered lines. |
| `apps/api/src/data-source.ts` and `apps/api/src/database/migrations/**` (24 migrations, 268 lines) | The TypeORM command-line data source and the generated schema migrations; they run against a real database. Three have specs (`src/database/*.spec.ts`). | Together with `main.ts`: API statements 49.21% (1879 / 3818), branches 39.14% (456 / 1165), functions 35.63% (232 / 651), lines 49.11% (1756 / 3575). |
| `apps/api/src/**/index.ts` (2 files) | Barrel files that only re-export. | None. |
| `apps/web/src/main.tsx`, `*.d.ts` files | Browser entry point and type declarations. | About a dozen statements. |
| The 22 `.astro` files of the landing page (pages, a layout and components) | Vitest does not transform `.astro` files, so V8 has nothing to map; they are not measured and not in the 10%. | The real coverage of the landing page is lower than reported. |
| Four API integration specs | They need a live PostgreSQL and skip themselves without it: 4 skipped suites and 32 skipped tests. No database was started for this baseline. | See below. |

The four integration specs, and the variable that switches each on:

| Spec | Variable | Exercises |
|------|----------|-----------|
| `src/auth/audit/auth-audit.integration.spec.ts` | `AUDIT_TEST_DATABASE_URL` | The audit hook and its migration. |
| `src/modules/backup/backup-lease.integration.spec.ts` | `BACKUP_LEASE_TEST_DATABASE_URL` | The backup lease and backup repositories. |
| `src/modules/jobs/analytics/jobs-analytics.integration.spec.ts` | `JOBS_ANALYTICS_TEST_DATABASE_URL` | The analytics repository. |
| `src/modules/restore/restore-lease.integration.spec.ts` | `RESTORE_LEASE_TEST_DATABASE_URL` | The restore lease and connections repositories. |

A fifth spec was added after the baseline, and the analytics spec grew:

| Spec | Variable | Tests | Exercises |
|------|----------|------:|-----------|
| `src/modules/backup/backup-rollup.integration.spec.ts` | `JOBS_ANALYTICS_TEST_DATABASE_URL` | 20 | The three delete paths of the backup repository (`deleteByFileKeys`, `deleteByIds`, `deleteFailedOlderThan`) against the daily analytics query: the daily series, with and without the connection filter, is identical before and after a full purge, a partial purge of a day, two purges of the same day and two concurrent purges; PENDING and RUNNING rows are deleted without being counted; completed rows without timestamps count but add no duration. |
| `src/modules/jobs/analytics/jobs-analytics.integration.spec.ts` | `JOBS_ANALYTICS_TEST_DATABASE_URL` | 32 (was 13) | Adds four tests of the live plus rollup merge in the daily query, and fifteen of the connections health (`GET /jobs/analytics/connections-health`): the window counts and percentiles over live and rolled-up rows, an inactive and a non-production connection left out, a connection with no job kept with zeros and nulls, the last backup ignoring pending and running rows, the active schedules and their interval, the freshness, and the daily totals equal to the overall counts. |

The new spec reuses the analytics variable. With the four variables set against a local PostgreSQL 16 on `localhost:5434`, the five integration suites ran 75 tests, 0 skipped (audit 4, backup lease 9, restore lease 10, analytics 32, backup rollup 20), measured on 2026-10-27. The same day, `pnpm -C apps/api test` without the variables ran 96 suites and 1628 tests, with 5 suites and 75 tests skipped. The unit tests of the rollup change are `src/database/1778716800025-create-backup-daily-rollups.spec.ts` (4 tests) and the purge block of `src/modules/backup/backup.repository.spec.ts` (8 tests). Those of the connections health are the `getConnectionsHealth` block of `jobs-analytics.service.spec.ts` (27 tests, with the freshness boundaries at exactly 1.5 and 3 intervals), `cron-interval.spec.ts` (14), `backup-analytics-source.spec.ts` (6), `dto/analytics-window.dto.spec.ts` (15) and four tests in `jobs-analytics.controller.spec.ts`; its 13 contract tests are in `e2e/tests/api/read-contracts.api.spec.ts` and need the running stack.

Because they are skipped, the repositories above are under-counted: their real coverage is higher than the figures here, and a run with the four variables set would raise the API numbers. Everything in the Baseline comes from the 55 suites that run without infrastructure.

---

## Adding a threshold

Nothing fails on low coverage today: this is measurement, not a gate. To make a run fail below a floor, add it to the config of the package. The values below are the baseline rounded down, so they block regressions without demanding more tests yet.

```ts
// apps/api/jest.config.ts
coverageThreshold: {
  global: { statements: 52, branches: 40, functions: 38, lines: 52 },
},

// apps/web/vitest.config.ts, inside `coverage`
thresholds: { statements: 26, branches: 27, functions: 24, lines: 27 },
```

You can try a floor without editing anything. Each of these exits with code 1 and names the metric that fell short:

```bash
pnpm --filter @vaultly-control/web exec vitest run --coverage --coverage.thresholds.lines=90
pnpm --filter @vaultly-control/api exec jest --coverage '--coverageThreshold={"global":{"lines":90}}'
```

The first prints `ERROR: Coverage for lines (27.91%) does not meet global threshold (90%)`, the second `Jest: Coverage for lines (52.93%) does not meet "global" threshold (90%)`. The second command is written for Git Bash; PowerShell needs the JSON quoted differently, so use the config file there.

---

## How it relates to the E2E suite

| | White-box (this page) | Black-box ([e2e-testing.md](e2e-testing.md)) |
|---|----------------------|----------------------------------------------|
| Sees the source | Yes: tests are designed from the code | No: only HTTP and the browser |
| Dependencies | Mocked: database, Redis, object storage | Real: PostgreSQL, MySQL, Redis, MinIO, Chromium |
| Needs Docker | No | Yes (`pnpm docker:e2e`) |
| Command | `pnpm test`, `pnpm test:coverage` | `pnpm test:e2e`, `pnpm test:e2e:perf` |
| Speed | About 20 s for all three packages | About 25 s for the functional suite, plus the stack start-up |
| Measures | Statements, branches, functions, lines | Behaviors checked; it reports no code coverage |
| Strong at | Logic and edge cases inside one unit | Integration, contracts, security and defects that only appear with real parts |

The two are complements, and the baseline shows it. White-box coverage says where unit tests are missing (MySQL restore, the connections module, the auth guard); the E2E suite shows that those paths work end to end today, and it found defects that coverage could not (D6 in a module whose service and controller have no spec, D13 on a line no unit test ran, D12 on a line they did run). Neither replaces the other. When a defect from [Known defects](e2e-testing.md#known-defects) is fixed, add its unit test first and re-measure; update the Baseline table when a change moves the numbers noticeably.
