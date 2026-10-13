import type { Locator, Page } from '@playwright/test';

/** What a person types into the form: every field is text, the port included. */
export interface ConnectionFormValues {
  name: string;
  dbType: 'postgres' | 'mysql';
  environment: 'dev' | 'qa' | 'prod';
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

/**
 * The /connections screen (admin only), located by the English copy of
 * `apps/web/src/locales/en/connections.json`.
 */
export class ConnectionsPage {
  readonly heading: Locator;
  /**
   * Opens the form. While the form is open this name belongs to the form's own
   * submit button instead, because the page hides this one.
   */
  readonly createButton: Locator;
  readonly search: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('main').getByRole('heading', { level: 1, name: 'Connections' });
    this.createButton = page.getByRole('button', { name: 'Create connection' });
    this.search = page.getByRole('textbox', { name: 'Search by name, host or DB...' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/connections');
  }

  /** A table row, found by the connection's name (names in the tests are unique). */
  row(name: string): Locator {
    return this.page.getByRole('row', { name });
  }

  form(): ConnectionForm {
    return new ConnectionForm(this.page);
  }
}

// The fields filled with plain text; `dbType` and `environment` are clicks and a select.
const TEXT_FIELDS = ['name', 'host', 'port', 'database', 'username', 'password'] as const;

/** The create and edit form: one card holding the fields and the three buttons. */
export class ConnectionForm {
  readonly root: Locator;
  readonly name: Locator;
  readonly environment: Locator;
  readonly host: Locator;
  readonly port: Locator;
  readonly database: Locator;
  readonly username: Locator;
  readonly password: Locator;
  readonly testButton: Locator;
  readonly cancelButton: Locator;
  /** The submit button: "Create connection" when creating ... */
  readonly createSubmit: Locator;
  /** ... and "Save changes" when editing. */
  readonly saveSubmit: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator('form').filter({ has: page.getByLabel('Host') });
    // exact: "Database name (e.g. mydb)" also contains the word "name".
    this.name = this.root.getByLabel('Name', { exact: true });
    this.environment = this.root.getByLabel('Environment');
    this.host = this.root.getByLabel('Host');
    this.port = this.root.getByLabel('Port');
    this.database = this.root.getByLabel('Database name (e.g. mydb)');
    this.username = this.root.getByLabel('Username');
    this.password = this.root.getByLabel('Password');
    this.testButton = this.root.getByRole('button', { name: 'Test connection' });
    this.cancelButton = this.root.getByRole('button', { name: 'Cancel' });
    this.createSubmit = this.root.getByRole('button', { name: 'Create connection' });
    this.saveSubmit = this.root.getByRole('button', { name: 'Save changes' });
  }

  /** Types the fields that are given, so a test can leave one out on purpose. */
  async fill(values: Partial<ConnectionFormValues>): Promise<void> {
    const { dbType, environment, ...text } = values;

    if (dbType) {
      await this.root.getByRole('button', { name: dbType === 'mysql' ? 'MySQL' : 'PostgreSQL' }).click();
    }
    if (environment) {
      await this.environment.selectOption(environment);
    }
    for (const field of TEXT_FIELDS) {
      const value = text[field];
      if (value !== undefined) {
        await this[field].fill(value);
      }
    }
  }
}
