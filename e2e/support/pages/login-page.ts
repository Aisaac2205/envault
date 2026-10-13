import type { Locator, Page } from '@playwright/test';
import type { Credentials } from '../env';

/**
 * The sign-in screen, located by the English copy of
 * `apps/web/src/locales/en/auth.json` (the app falls back to English when the
 * browser has no stored language).
 */
export class LoginPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly showPassword: Locator;
  readonly hidePassword: Locator;
  readonly alert: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Welcome back' });
    this.email = page.getByLabel('Email address');
    // exact: the "Show password" toggle button also matches a loose "Password".
    this.password = page.getByLabel('Password', { exact: true });
    this.submit = page.getByRole('button', { name: 'Sign in' });
    this.showPassword = page.getByRole('button', { name: 'Show password' });
    this.hidePassword = page.getByRole('button', { name: 'Hide password' });
    this.alert = page.getByRole('alert');
  }

  async open(): Promise<void> {
    await this.page.goto('/login');
  }

  async signIn({ email, password }: Credentials): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
