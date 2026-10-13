import { expect, test } from '@playwright/test';
import { SIGNED_OUT } from '../../support/auth-state';

// Locators follow the visible English copy (apps/web/src/locales/en/auth.json):
// the app falls back to English when no language is stored in the browser.
test.describe('login page', () => {
  test.describe('signed out', () => {
    test.use({ storageState: SIGNED_OUT });

    test('renders the email and password form', async ({ page }) => {
      await page.goto('/login');

      await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
      await expect(page.getByLabel('Email address')).toBeVisible();
      // exact: the "Show password" toggle button also matches a loose "Password".
      await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    });

    test('redirects a protected route to the login page', async ({ page }) => {
      await page.goto('/');

      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });
  });

  test.describe('with the saved admin session', () => {
    test('opens the app instead of redirecting to the login page', async ({ page }) => {
      await page.goto('/');

      // Wait for the signed-in shell first: the URL is "/" during the brief
      // session check too, so asserting the URL alone could pass too early.
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);
    });
  });
});
