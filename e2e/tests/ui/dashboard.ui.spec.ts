import { expect, test } from '../../support/fixtures';
import { mockApiGet } from '../../support/mock-api';
import { ConnectionsPage } from '../../support/pages/connections-page';
import { DashboardPage } from '../../support/pages/dashboard-page';

// Locators follow the visible English copy (apps/web/src/locales/en/dashboard.json).
//
// The dashboard shows system-wide figures (jobs, connections, storage) that
// other specs change while these run in parallel. The specs that use the real
// stack therefore check structure and the shape of each figure, never a value;
// the empty system is shown by canning the API's answers.

// A dash is a figure with nothing to summarise yet (no backup finished, no restore ran).
const KPI_CARDS = [
  { label: 'Success rate last 30 days', shape: /^(\d+(\.\d+)?%|—)$/ },
  { label: 'Backups last 7 days', shape: /^\d+$/ },
  { label: 'p95 duration last 30 days', shape: /^(—|\d+ ms|\d+(\.\d+)? s|\d+ m \d{2} s|\d+ h \d{2} m)$/ },
  { label: 'Last restore', shape: /^(Completed|Failed|Running|Pending|—)$/ },
];

const PANELS = [
  'Backup calendar',
  'Recent failures',
  'Storage by connection',
  'Connection status',
];

// Every request the dashboard makes for its data, in the paths the browser uses.
const DATA_ENDPOINTS = [
  '/api/jobs/backups',
  '/api/jobs/restores',
  '/api/connections',
  '/api/jobs/analytics/daily',
  '/api/jobs/analytics/storage-by-connection',
  '/api/jobs/analytics/connections-health',
];

test.describe('dashboard with the real stack', () => {
  test('shows its title and a figure in each KPI card', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.heading).toBeVisible();
    await expect(page.getByText('Backup and restore monitoring')).toBeVisible();
    for (const { label, shape } of KPI_CARDS) {
      await expect(dashboard.kpiValue(label), label).toHaveText(shape);
    }
  });

  test('shows a panel for backups, storage and the health of each connection', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    for (const title of PANELS) {
      await expect(dashboard.panelTitle(title), title).toBeVisible();
    }
  });

  // About defect D4: /api/health is not part of the public API (health is
  // internal, see health.api.spec.ts) and the dashboard has no client for it.
  // The "Connection status" panel reads /api/jobs/analytics/connections-health.
  // If a screen starts calling /api/health, this test fails on that 404.
  test('makes only requests that succeed', async ({ page }) => {
    const answered = new Set<string>();
    const failed: string[] = [];
    page.on('response', (response) => {
      const { pathname } = new URL(response.url());
      if (!pathname.startsWith('/api/')) {
        return;
      }
      answered.add(pathname);
      if (response.status() >= 400) {
        failed.push(`${response.status()} ${response.request().method()} ${pathname}`);
      }
    });

    await new DashboardPage(page).goto();

    // Wait until every data request has been answered, then judge them together.
    await expect.poll(() => DATA_ENDPOINTS.filter((path) => !answered.has(path))).toEqual([]);
    expect(failed).toEqual([]);
  });
});

test.describe('dashboard of an empty system', () => {
  test.beforeEach(async ({ page }) => {
    // No connection, job or stored backup exists, whatever the other specs are
    // doing to the shared stack at this moment.
    await mockApiGet(page, 'connections', []);
    await mockApiGet(page, 'jobs/backups', []);
    await mockApiGet(page, 'jobs/restores', []);
    // The analytics behind the KPIs and the panels: no backup ever ran, nothing is
    // stored and there is no production connection to report on.
    await mockApiGet(page, 'jobs/analytics/daily', {
      window: 30,
      from: '2026-09-28',
      to: '2026-10-27',
      timezone: 'UTC',
      connectionId: null,
      days: [],
    });
    await mockApiGet(page, 'jobs/analytics/storage-by-connection', []);
    await mockApiGet(page, 'jobs/analytics/connections-health', {
      window: 30,
      from: '2026-09-28',
      to: '2026-10-27',
      timezone: 'UTC',
      overall: {
        completed: 0,
        failed: 0,
        successRate: null,
        p50DurationSeconds: null,
        p95DurationSeconds: null,
      },
      connections: [],
    });
  });

  test('welcomes the admin and explains each empty panel', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(page.getByRole('heading', { name: 'Welcome to EnVault Management' })).toBeVisible();
    // Nothing finished, so there is no rate or duration to show, and no restore ran.
    await expect(dashboard.kpiValue('Success rate last 30 days')).toHaveText('—');
    await expect(dashboard.kpiValue('Backups last 7 days')).toHaveText('0');
    await expect(dashboard.kpiValue('p95 duration last 30 days')).toHaveText('—');
    await expect(dashboard.kpiValue('Last restore')).toHaveText('—');
    for (const heading of [
      'No completed backups in this period',
      'No backups in this period',
      'No stored backups',
      'No production connections',
    ]) {
      await expect(page.getByRole('heading', { name: heading }), heading).toBeVisible();
    }
    // The recent failures card says it in a line, not a heading: nothing failed.
    await expect(page.getByText('No failed backups', { exact: true })).toBeVisible();
  });

  test('leads from the welcome banner to the connections page', async ({ page }) => {
    await new DashboardPage(page).goto();

    await page.getByRole('link', { name: 'Connect database' }).click();

    await expect(page).toHaveURL('/connections');
    await expect(new ConnectionsPage(page).heading).toBeVisible();
  });
});
