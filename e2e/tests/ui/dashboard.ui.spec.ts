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

const KPI_CARDS = [
  { label: 'Success rate (30d)', shape: /^\d+(\.\d+)?%$/ },
  { label: 'Backups last 7 days', shape: /^\d+$/ },
  { label: 'Failed', shape: /^\d+$/ },
  { label: 'Active connections', shape: /^\d+\/\d+$/ },
];

const PANELS = [
  'Backups per day',
  'Recent backups',
  'Storage by connection',
  'System health',
  'Upcoming runs',
];

// Every request the dashboard makes for its data, in the paths the browser uses.
const DATA_ENDPOINTS = [
  '/api/jobs/backups',
  '/api/jobs/restores',
  '/api/connections',
  '/api/backups/r2',
  '/api/cronjobs',
  '/api/jobs/stats',
  '/api/jobs/daily-counts',
  '/api/jobs/analytics/daily',
  '/api/jobs/analytics/storage-by-connection',
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

  test('shows a panel for backups, restores, storage and schedules', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    for (const title of PANELS) {
      await expect(dashboard.panelTitle(title), title).toBeVisible();
    }
  });

  // About defect D4: /api/health is not part of the public API (health is
  // internal, see health.api.spec.ts) and the dashboard has no client for it.
  // The "System health" panel is a storage summary filled from /api/backups/r2.
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
    // No connection, job, stored backup or cronjob exists, whatever the other
    // specs are doing to the shared stack at this moment.
    await mockApiGet(page, 'connections', []);
    await mockApiGet(page, 'jobs/backups', []);
    await mockApiGet(page, 'jobs/restores', []);
    await mockApiGet(page, 'backups/r2', []);
    await mockApiGet(page, 'cronjobs', []);
    await mockApiGet(page, 'jobs/daily-counts', []);
    // The analytics behind the charts: no backup ever ran and nothing is stored.
    await mockApiGet(page, 'jobs/analytics/daily', {
      window: 30,
      from: '2026-09-28',
      to: '2026-10-27',
      timezone: 'UTC',
      connectionId: null,
      days: [],
    });
    await mockApiGet(page, 'jobs/analytics/storage-by-connection', []);
    await mockApiGet(page, 'jobs/stats', {
      successRate30d: 0,
      backupsToday: 0,
      failed7d: 0,
      totalStorageMb: 0,
    });
  });

  test('welcomes the admin and explains each empty panel', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(page.getByRole('heading', { name: 'Welcome to EnVault Management' })).toBeVisible();
    await expect(dashboard.kpiValue('Success rate (30d)')).toHaveText('0%');
    await expect(dashboard.kpiValue('Backups last 7 days')).toHaveText('0');
    await expect(dashboard.kpiValue('Failed')).toHaveText('0');
    await expect(dashboard.kpiValue('Active connections')).toHaveText('0/0');
    for (const heading of [
      'No completed backups in this period',
      'No backups in this period',
      'No recent backups',
      'No stored backups',
      'No health data',
      'No scheduled runs',
    ]) {
      await expect(page.getByRole('heading', { name: heading }), heading).toBeVisible();
    }
  });

  test('leads from the welcome banner to the connections page', async ({ page }) => {
    await new DashboardPage(page).goto();

    await page.getByRole('link', { name: 'Connect database' }).click();

    await expect(page).toHaveURL('/connections');
    await expect(new ConnectionsPage(page).heading).toBeVisible();
  });
});
