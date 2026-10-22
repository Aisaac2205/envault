import type { Page } from '@playwright/test';
import { SIGNED_OUT } from '../../support/auth-state';
import { adminCredentials } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { AppShell } from '../../support/pages/app-shell';
import { DashboardPage } from '../../support/pages/dashboard-page';
import { LoginPage } from '../../support/pages/login-page';
import { uniqueId } from '../../support/unique';

// Locators follow the visible English copy (apps/web/src/locales/en/auth.json):
// the app falls back to English when no language is stored in the browser.
//
// The sign-in here is real: the form posts to the real API and the browser
// ends up with a real session. The `context` fixture only moves its auth calls
// out of the rate-limit bucket that `setup` and the other specs share (D3),
// see support/browser.ts.

const SIGN_IN_PATH = '/api/auth/sign-in/email';

/** Collects the sign-in requests the page sends, to show that a form sent none. */
function recordSignIns(page: Page): string[] {
  const methods: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === SIGN_IN_PATH) {
      methods.push(request.method());
    }
  });
  return methods;
}

test.describe('login page', () => {
  test.describe('signed out', () => {
    // The sign-in screen paints an animated WebGL panel from 1024 px wide. In
    // headless Chromium it renders in software and makes each test several
    // seconds slower (this file took 1.2 min at 1280 px against 18 s here).
    // Below that width the app hides the panel and the form is the same, so
    // the specs use a window just under it.
    test.use({ storageState: SIGNED_OUT, viewport: { width: 1000, height: 720 } });

    test('renders the email and password form', async ({ page }) => {
      const login = new LoginPage(page);
      await login.open();

      await expect(login.heading).toBeVisible();
      await expect(login.email).toBeVisible();
      await expect(login.password).toBeVisible();
      await expect(login.password).toHaveAttribute('type', 'password');
      await expect(login.submit).toBeEnabled();
    });

    test('redirects a protected route to the login page', async ({ page }) => {
      await page.goto('/');

      await expect(page).toHaveURL(/\/login$/);
      await expect(new LoginPage(page).submit).toBeVisible();
    });

    test('does not send an empty form', async ({ page }) => {
      const signIns = recordSignIns(page);
      const login = new LoginPage(page);
      await login.open();

      await login.submit.click();

      // The browser's own validation blocks the submit: both fields are required.
      await expect(page.locator('input:invalid')).toHaveCount(2);
      expect(signIns).toEqual([]);
      await expect(login.alert).toBeHidden();
    });

    test('does not send an email without an @', async ({ page }) => {
      const signIns = recordSignIns(page);
      const login = new LoginPage(page);
      await login.open();

      await login.email.fill('not-an-email');
      await login.password.fill('irrelevant');
      await login.submit.click();

      await expect(page.locator('input:invalid')).toHaveAttribute('type', 'email');
      expect(signIns).toEqual([]);
    });

    test('toggles the visibility of the password', async ({ page }) => {
      const login = new LoginPage(page);
      await login.open();
      await login.password.fill('not-a-real-password');

      await expect(login.password).toHaveAttribute('type', 'password');
      await login.showPassword.click();
      await expect(login.password).toHaveAttribute('type', 'text');
      await expect(login.password).toHaveValue('not-a-real-password');

      await login.hidePassword.click();
      await expect(login.password).toHaveAttribute('type', 'password');
    });

    test('shows the error for a wrong password and stays on the page', async ({ page }) => {
      const login = new LoginPage(page);
      await login.open();

      await login.signIn({ email: adminCredentials().email, password: `wrong-${uniqueId()}` });

      // The text comes from the API (INVALID_EMAIL_OR_PASSWORD), shown in the alert region.
      await expect(login.alert).toHaveText('Invalid email or password');
      await expect(login.email).toHaveAccessibleDescription('Invalid email or password');
      await expect(page).toHaveURL(/\/login$/);
      await expect(login.submit).toBeEnabled();
    });

    test('shows the server message when sign-ins are rate limited', async ({ page }) => {
      const login = new LoginPage(page);
      await login.open();
      // A canned answer: the real limiter would have to be exhausted to get this,
      // and the API suite already covers that behavior. A route on the page
      // takes precedence over the context route that the `context` fixture
      // installs for every auth call.
      await page.route(
        (url) => url.pathname === SIGN_IN_PATH,
        (route) =>
          route.fulfill({
            status: 429,
            headers: { 'x-retry-after': '9' },
            json: { message: 'Too many requests. Please try again later.' },
          }),
      );

      await login.signIn({ email: adminCredentials().email, password: 'irrelevant' });

      await expect(login.alert).toHaveText('Too many requests. Please try again later.');
      await expect(login.submit).toBeEnabled();
    });

    // Regression test for D11 (fixed): the submit handler used to await
    // authClient.signIn.email without a try/catch, so a network failure (API
    // down, connection reset) left the button on "Signing in..." with no
    // message. LoginPage now catches it, shows the message in the alert region
    // and re-enables the form.
    test('tells the user when the API cannot be reached', async ({ page }) => {
      const login = new LoginPage(page);
      await login.open();
      await page.route(
        (url) => url.pathname === SIGN_IN_PATH,
        (route) => route.abort('connectionrefused'),
      );

      await login.signIn({ email: adminCredentials().email, password: 'irrelevant' });

      await expect(login.alert).toHaveText(
        "We couldn't reach the server. Check your connection and try again.",
      );
      await expect(login.submit).toBeEnabled();
    });

    test('signs in and lands on the dashboard with a session that survives a reload', async ({
      page,
      context,
    }) => {
      const { email } = adminCredentials();
      const login = new LoginPage(page);
      const dashboard = new DashboardPage(page);
      await login.open();

      await login.signIn(adminCredentials());

      await expect(page).toHaveURL('/');
      await expect(dashboard.heading).toBeVisible();
      expect((await context.cookies()).map(({ name }) => name)).toContain(
        'better-auth.session_token',
      );

      await page.reload();
      await expect(dashboard.heading).toBeVisible();
      // The API knows the same session: the browser is signed in for real.
      const session = await (await page.request.get('/api/auth/get-session')).json();
      expect(session.user.email).toBe(email);
    });

    test('logs out of its own session and leaves the shared admin session alone', async ({
      page,
      adminApi,
    }) => {
      const { email } = adminCredentials();
      const login = new LoginPage(page);
      const shell = new AppShell(page);
      await login.open();
      await login.signIn(adminCredentials());
      await expect(shell.account).toBeVisible();

      await shell.logOut();

      await expect(page).toHaveURL(/\/login$/);
      await expect(login.heading).toBeVisible();
      // The session is gone: a protected route sends the visitor back to the login.
      await page.goto('/');
      await expect(page).toHaveURL(/\/login$/);

      // Logging out ended only the session this test created. disableCookieCache
      // makes the API check its database instead of trusting the signed cookie.
      const shared = await adminApi.get('auth/get-session?disableCookieCache=true');
      expect((await shared.json()).user.email).toBe(email);
    });
  });

  test.describe('with the saved admin session', () => {
    test('opens the app instead of redirecting to the login page', async ({ page }) => {
      await page.goto('/');

      // Wait for the signed-in shell first: the URL is "/" during the brief
      // session check too, so asserting the URL alone could pass too early.
      await expect(new AppShell(page).link('Dashboard')).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    });

    test('sends a signed-in visitor from the login page to the dashboard', async ({ page }) => {
      await page.goto('/login');

      await expect(new DashboardPage(page).heading).toBeVisible();
      await expect(page).toHaveURL('/');
    });
  });
});
