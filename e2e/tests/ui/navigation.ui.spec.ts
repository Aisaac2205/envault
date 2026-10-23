import { SIGNED_OUT } from '../../support/auth-state';
import { adminCredentials } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { AppShell } from '../../support/pages/app-shell';
import { DashboardPage } from '../../support/pages/dashboard-page';
import { NoAccessPage } from '../../support/pages/no-access-page';

// The sections come from apps/web/src/shared/lib/sections.ts (links and order).
// Which of them a user sees is not decided by the web app: it shows the ones
// that GET /api/me/permissions lists, and the API builds that list from its
// permission map (apps/api/src/common/authorization/permissions.ts).
// `link` is the sidebar text, `heading` the title of the page it opens.
interface Section {
  link: string;
  path: string;
  heading: string;
}

const SECTIONS: Section[] = [
  { link: 'Dashboard', path: '/', heading: 'Dashboard' },
  { link: 'Backups', path: '/dumps', heading: 'Dumps' },
  { link: 'Cleanup', path: '/cleanup', heading: 'Cleanup' },
  { link: 'Restore', path: '/restore', heading: 'Restore' },
  { link: 'Cronjobs', path: '/cronjobs', heading: 'Cronjobs' },
  { link: 'Connections', path: '/connections', heading: 'Connections' },
  { link: 'Users', path: '/users', heading: 'Users' },
  { link: 'Audit', path: '/audit', heading: 'Audit' },
];

// The id never reaches the API: the route guard redirects before the page loads.
const AUDIT_DETAIL = '/audit/00000000-0000-4000-8000-000000000000';

test.describe('admin navigation', () => {
  test('lists every section in the sidebar, in order', async ({ page }) => {
    const shell = new AppShell(page);
    await page.goto('/');

    await expect(shell.sidebarLinks).toHaveText(SECTIONS.map(({ link }) => link));
    for (const { link, path } of SECTIONS) {
      await expect(shell.link(link)).toHaveAttribute('href', path);
    }
  });

  for (const { link, path, heading } of SECTIONS) {
    test(`opens ${link} from the sidebar`, async ({ page }) => {
      const shell = new AppShell(page);
      // Start somewhere else, so that the click is what changes the page.
      await page.goto(path === '/' ? '/audit' : '/');

      await shell.link(link).click();

      await expect(page).toHaveURL(path);
      await expect(shell.pageHeading).toHaveText(heading);
      await expect(shell.link(link)).toHaveAttribute('aria-current', 'page');
      await expect(shell.breadcrumbs).toContainText(link);
    });
  }

  test('identifies the signed-in account in the sidebar', async ({ page }) => {
    const shell = new AppShell(page);
    await page.goto('/');

    await expect(shell.account).toContainText('Administrator');
    await shell.account.click();
    await expect(page.getByRole('dialog')).toContainText(adminCredentials().email);
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });
});

// A second user, whose role is `user`, created once per worker by the
// `nonAdmin` fixture. Its browser session is the one that fixture signed in.
const nonAdminTest = test.extend({
  storageState: async ({ nonAdmin }, use) => {
    await use(await nonAdmin.storageState());
  },
});

// Defect D8 (fixed): the sidebar and the router used to offer a regular user
// the dashboard, restore, cronjobs and audit, although every API endpoint
// behind them is admin-only, so each opened to 403s and an empty screen. The
// API's permission map is now the single source of truth: this user is granted
// no feature, so the web app offers no section and says so.
nonAdminTest.describe('regular user navigation', () => {
  nonAdminTest('sees no section in the sidebar and lands on the no-access page', async ({ page }) => {
    const shell = new AppShell(page);
    const noAccess = new NoAccessPage(page);
    await page.goto('/');

    await expect(noAccess.heading).toBeVisible();
    await expect(noAccess.explanation).toBeVisible();
    await expect(noAccess.askAnAdministrator).toBeVisible();
    await expect(page).toHaveURL('/no-access');
    // The shell is there, with the account menu, but no navigation entry.
    await expect(shell.sidebar).toBeVisible();
    await expect(shell.sidebarLinks).toHaveCount(0);
    await expect(shell.account).toContainText('User');
    await expect(shell.account).not.toContainText('Administrator');
  });

  nonAdminTest('can still log out from the no-access page', async ({ page }) => {
    await page.goto('/');

    // Only checked, not clicked: signing out revokes the session that the
    // other tests of this worker share.
    await expect(new NoAccessPage(page).logOut).toBeVisible();
  });

  nonAdminTest('asks the API for nothing it refuses', async ({ page }) => {
    const refused: string[] = [];
    page.on('response', (response) => {
      const { pathname } = new URL(response.url());
      if (pathname.startsWith('/api/') && [401, 403].includes(response.status())) {
        refused.push(`${response.status()} ${pathname}`);
      }
    });

    await page.goto('/');
    await expect(new NoAccessPage(page).heading).toBeVisible();

    expect(refused).toEqual([]);
  });

  for (const { link, path } of SECTIONS) {
    nonAdminTest(`is sent from ${link} (${path}) to the no-access page`, async ({ page }) => {
      await page.goto(path);

      await expect(new NoAccessPage(page).heading).toBeVisible();
      await expect(page).toHaveURL('/no-access');
    });
  }

  nonAdminTest('is sent from an audit entry to the no-access page', async ({ page }) => {
    await page.goto(AUDIT_DETAIL);

    await expect(new NoAccessPage(page).heading).toBeVisible();
    await expect(page).toHaveURL('/no-access');
  });
});

test.describe('unknown address', () => {
  const UNKNOWN = '/no/such/screen';

  test.describe('signed out', () => {
    test.use({ storageState: SIGNED_OUT });

    test('serves the app but never the signed-in shell', async ({ page }) => {
      const response = await page.goto(UNKNOWN);

      // nginx falls back to index.html for any path, so deep links reach the router.
      expect(response?.status()).toBe(200);
      // Wait for the router to render something before looking for what is absent.
      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(new AppShell(page).sidebar).toBeHidden();
      // The catch-all route sits behind the same guard as every other address.
      await expect(page).toHaveURL('/login');
    });
  });

  // Regression test for D9 (fixed): the router had no catch-all route and no
  // errorElement, so an address it does not know showed React Router's
  // developer screen ("Unexpected Application Error! 404 Not Found"). The
  // catch-all route now renders a not-found screen inside the app shell for a
  // signed-in user, with a way back to the dashboard.
  test('shows a product screen, not the router developer error', async ({ page }) => {
    const shell = new AppShell(page);

    await page.goto(UNKNOWN);

    await expect(shell.pageHeading).toHaveText('Page not found');
    await expect(shell.sidebar).toBeVisible();
    await expect(page.getByText('Unexpected Application Error!')).toBeHidden();
    // The address stays as typed, and the screen offers a way out.
    await expect(page).toHaveURL(UNKNOWN);

    await page.getByRole('link', { name: 'Back to Dashboard' }).click();

    await expect(page).toHaveURL('/');
    await expect(new DashboardPage(page).heading).toBeVisible();
  });
});
