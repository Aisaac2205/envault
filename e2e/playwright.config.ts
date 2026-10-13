import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_FILE } from './support/auth-state';
import { API_URL, BASE_URL } from './support/env';

/**
 * Black-box E2E suite for the hermetic Docker stack (`pnpm docker:e2e`).
 * Nothing is started from here: the stack is an external prerequisite.
 *
 * Projects:
 *   setup        signs in once and saves the admin session
 *   api          HTTP specs, reuse the saved session
 *   ui-chromium  browser specs, reuse the saved session; their auth calls use a
 *                rate-limit bucket of their own (support/browser.ts)
 */
export default defineConfig({
  testDir: './tests',
  outputDir: path.resolve(__dirname, 'test-results'),

  // No retries on purpose: a flaky spec should fail loudly, not pass on try two.
  retries: 0,
  forbidOnly: !!process.env.CI,
  fullyParallel: true,

  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.resolve(__dirname, 'playwright-report') }],
  ],

  use: {
    // retain-on-failure (not on-first-retry) because retries are off.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'api',
      testDir: './tests/api',
      testMatch: /.*\.api\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        // The trailing slash keeps `/api` in the URL: specs pass paths without
        // a leading slash (`request.get('connections')`), which resolve under
        // it. A leading slash would drop `/api` and hit the SPA instead.
        baseURL: `${API_URL}/`,
        // Better Auth routes reject requests that carry no Origin header.
        extraHTTPHeaders: { Origin: BASE_URL },
        storageState: AUTH_STATE_FILE,
      },
    },
    {
      name: 'ui-chromium',
      testDir: './tests/ui',
      testMatch: /.*\.ui\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        storageState: AUTH_STATE_FILE,
      },
    },
  ],
});
