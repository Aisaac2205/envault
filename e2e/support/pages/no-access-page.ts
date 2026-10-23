import type { Locator, Page } from '@playwright/test';

/**
 * The screen a signed-in user lands on when the API grants them no section
 * (route "/no-access"), located by the English copy of `locales/en/auth.json`.
 */
export class NoAccessPage {
  readonly heading: Locator;
  readonly explanation: Locator;
  readonly askAnAdministrator: Locator;
  /** The way out that stays reachable even though the sidebar offers no section. */
  readonly logOut: Locator;

  constructor(page: Page) {
    const main = page.getByRole('main');
    this.heading = main.getByRole('heading', { level: 1, name: 'No access' });
    this.explanation = main.getByRole('heading', { name: "You don't have access to any section" });
    this.askAnAdministrator = main.getByText('Ask an administrator for access.');
    this.logOut = main.getByRole('button', { name: 'Log out' });
  }
}
