import type { Locator, Page } from '@playwright/test';

/**
 * The /dumps screen (admin only), located by the English copy of
 * `apps/web/src/locales/en/dumps.json`: the backup history, plus the control
 * that starts a manual backup of a production connection.
 */
export class DumpsPage {
  readonly heading: Locator;
  readonly filtersButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('main').getByRole('heading', { level: 1, name: 'Dumps' });
    this.filtersButton = page.getByRole('button', { name: 'Filters' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/dumps');
  }

  /** Starts a manual backup the way a person does: choose, press the button, confirm. */
  async createBackup(connectionName: string): Promise<void> {
    // The only combobox on the screen while the filters are closed. It lists
    // the production connections but has no accessible name of its own.
    await this.page.getByRole('main').getByRole('combobox').click();
    await this.page.getByRole('option', { name: connectionName }).click();
    await this.page.getByRole('button', { name: 'Create backup' }).click();
    // The confirmation dialog has a button with the same name, so scope to it.
    await this.page.getByRole('dialog').getByRole('button', { name: 'Create backup' }).click();
  }

  /** Narrows the history to one connection, so the page cannot be pushed out by other jobs. */
  async filterByConnection(connectionName: string): Promise<void> {
    await this.filtersButton.click();
    // The popover lists Connection first, then Environment and Status.
    await this.page.getByRole('dialog').getByRole('combobox').first().click();
    await this.page.getByRole('option', { name: connectionName }).click();
    await this.page.keyboard.press('Escape');
  }

  /** A row of the history, found by the connection's name (names in the tests are unique). */
  row(connectionName: string): Locator {
    return this.page.getByRole('row', { name: connectionName });
  }
}
