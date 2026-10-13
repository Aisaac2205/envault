import { SIGNED_OUT } from '../../support/auth-state';
import { adminCredentials } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { AppShell } from '../../support/pages/app-shell';
import { DashboardPage } from '../../support/pages/dashboard-page';

// The sections come from apps/web/src/shared/components/Sidebar.tsx (links and
// order) and apps/web/src/router.tsx (which routes demand the admin role).
// `link` is the sidebar text, `heading` the title of the page it opens.
interface Section {
  link: string;
  path: string;
  heading: string;
  adminOnly: boolean;
}

const SECTIONS: Section[] = [
  { link: 'Dashboard', path: '/', heading: 'Dashboard', adminOnly: false },
  { link: 'Backups', path: '/dumps', heading: 'Dumps', adminOnly: true },
  { link: 'Cleanup', path: '/cleanup', heading: 'Cleanup', adminOnly: true },
  { link: 'Restore', path: '/restore', heading: 'Restore', adminOnly: false },
  { link: 'Cronjobs', path: '/cronjobs', heading: 'Cronjobs', adminOnly: false },
  { link: 'Connections', path: '/connections', heading: 'Connections', adminOnly: true },
  { link: 'Users', path: '/users', heading: 'Users', adminOnly: true },
  { link: 'Audit', path: '/audit', heading: 'Audit', adminOnly: false },
];

const ADMIN_ONLY = SECTIONS.filter(({ adminOnly }) => adminOnly);
const OPEN_TO_ANY_USER = SECTIONS.filter(({ adminOnly, path }) => !adminOnly && path !== '/');

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

nonAdminTest.describe('regular user navigation', () => {
  nonAdminTest('sees only the sections that are not for admins', async ({ page }) => {
    const shell = new AppShell(page);
    await page.goto('/');

    await expect(shell.sidebarLinks).toHaveText(
      SECTIONS.filter(({ adminOnly }) => !adminOnly).map(({ link }) => link),
    );
    await expect(shell.account).toContainText('User');
    await expect(shell.account).not.toContainText('Administrator');
  });

  for (const { link, path } of ADMIN_ONLY) {
    nonAdminTest(`is sent from ${link} (${path}) to the dashboard`, async ({ page }) => {
      await page.goto(path);

      await expect(new DashboardPage(page).heading).toBeVisible();
      await expect(page).toHaveURL('/');
    });
  }

  nonAdminTest('is sent from an audit entry to the dashboard', async ({ page }) => {
    await page.goto(AUDIT_DETAIL);

    await expect(new DashboardPage(page).heading).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  for (const { link, path, heading } of OPEN_TO_ANY_USER) {
    nonAdminTest(`can open ${link} (${path})`, async ({ page }) => {
      await page.goto(path);

      await expect(new AppShell(page).pageHeading).toHaveText(heading);
      await expect(page).toHaveURL(path);
    });
  }

  // Known defect D8: the router and the sidebar offer these four screens to
  // every signed-in user, but each one is filled from endpoints that only an
  // admin may call (every Nest controller is @Roles('admin'); see
  // authorization.api.spec.ts). A regular user opens them, gets 403 on all the
  // data requests and sees an empty or endlessly loading screen with no
  // explanation. The fix is either to open those endpoints to the `user` role
  // or to stop offering the screens. These assert that a screen a user can
  // open can read its data. When one is fixed it passes, Playwright reports an
  // unexpected pass and fails the run: delete `fail` then.
  const DATA_BEHIND_USER_SCREENS = [
    { path: '/', api: '/api/jobs/stats' },
    { path: '/restore', api: '/api/restores' },
    { path: '/cronjobs', api: '/api/cronjobs' },
    { path: '/audit', api: '/api/audit' },
  ];

  for (const { path, api } of DATA_BEHIND_USER_SCREENS) {
    nonAdminTest.fail(
      `${path} can load its data (${api})`,
      {
        annotation: {
          type: 'known-defect',
          description: `D8: ${api} answers 403 to the screens a regular user can open`,
        },
      },
      async ({ page }) => {
        const answered = page.waitForResponse((response) => new URL(response.url()).pathname === api);
        await page.goto(path);
        // The screen itself opens (this part holds today) ...
        await expect(new AppShell(page).pageHeading).toBeVisible();

        // ... but the data behind it is refused.
        expect((await answered).status()).toBeLessThan(400);
      },
    );
  }
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
    });
  });

  // Known defect D9: the router has no catch-all route and no errorElement, so
  // an address it does not know shows React Router's built-in developer screen
  // ("Unexpected Application Error! 404 Not Found ... Hey developer") to the
  // user. A product screen (a not-found page, or a redirect to the dashboard)
  // is the expected behavior. When it is fixed the test passes, Playwright
  // reports an unexpected pass and fails the run: delete `fail` then.
  test.fail(
    'shows a product screen, not the router developer error',
    {
      annotation: {
        type: 'known-defect',
        description: 'D9: an unknown address renders React Router\'s default error screen',
      },
    },
    async ({ page }) => {
      await page.goto(UNKNOWN);

      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(page.getByText('Unexpected Application Error!')).toBeHidden();
    },
  );
});
