import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_FILE } from './support/auth-state';
import { BASE_URL } from './support/env';
import { newRunId, RUN_ID_VARIABLE } from './support/perf/results';

/**
 * Performance suite for the hermetic Docker stack (`pnpm docker:e2e`). It has a
 * config of its own on purpose: a bare `playwright test` runs every project of
 * `playwright.config.ts`, and a benchmark must never ride along with the
 * functional suite. Run it with `pnpm test:e2e:perf`.
 *
 * Projects:
 *   perf-unit  the statistics, report and configuration helpers; no stack needed.
 *              `setup` depends on it, so a broken helper stops the run before the
 *              long measurements instead of after them.
 *   setup      the same sign-in as the functional suite (tests/setup)
 *   perf       the measurements: throughput, BullMQ queue, front-end, API latency
 *
 * Everything runs in one worker, one test at a time: the numbers are only worth
 * having if nothing else uses the stack while they are taken.
 */

// One id for the whole run: the config is loaded by the runner, then by the
// worker, and the worker inherits the variable set here.
process.env[RUN_ID_VARIABLE] ??= newRunId();

export default defineConfig({
  testDir: './tests',
  // Not `test-results`: the functional config empties that folder on every run.
  outputDir: path.resolve(__dirname, 'test-results-perf'),

  // A slow machine must not turn a benchmark red, and a retry would hide a
  // flaky measurement: the specs fail only on functional errors, and loudly.
  retries: 0,
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,

  // Cases that move hundreds of megabytes set their own, derived from the size.
  timeout: 120_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['./support/perf/summary-reporter.ts']],

  use: {
    // Tracing and screenshots would add work to the very timings under test.
    trace: 'off',
    screenshot: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'perf-unit',
      testDir: './tests/perf',
      testMatch: /.*\.unit\.spec\.ts/,
    },
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts/,
      dependencies: ['perf-unit'],
    },
    {
      name: 'perf',
      testDir: './tests/perf',
      testMatch: /.*\.perf\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        storageState: AUTH_STATE_FILE,
      },
    },
  ],
});
