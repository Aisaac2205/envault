import path from 'node:path';
import { defineConfig } from '@playwright/test';
import functionalConfig from './playwright.config';

/**
 * Evidence run of the functional suite (`pnpm test:e2e:evidence`): the same
 * projects, specs and settings as `playwright.config.ts`, but every test keeps
 * its artifacts, passed or not. Meant for presentations and audits; a normal
 * run keeps artifacts of failures only.
 *
 * - Screenshots apply to the browser specs (ui-chromium): one at the end of
 *   each test.
 * - The trace is the evidence for the HTTP-only projects (api, pipeline):
 *   Playwright traces record every call of the `request` fixture
 *   (APIRequestContext, since 1.20) with its request and response, next to the
 *   actions, network and DOM snapshots of the browser specs.
 *
 * A config of its own rather than an environment variable, so the command is
 * the same on every shell. Its output lives apart from the functional run's,
 * so `pnpm test:e2e` never empties an evidence report.
 */
export default defineConfig({
  ...functionalConfig,
  outputDir: path.resolve(__dirname, 'test-results-evidence'),

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.resolve(__dirname, 'playwright-report-evidence') }],
  ],

  use: {
    ...functionalConfig.use,
    trace: 'on',
    screenshot: 'on',
  },
});
