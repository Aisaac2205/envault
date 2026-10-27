import type { Page } from '@playwright/test';
import { expectSuccessEnvelope } from '../../support/envelope';
import { adminCredentials } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { mockApiGet } from '../../support/mock-api';
import { ConnectionsPage, type ConnectionFormValues } from '../../support/pages/connections-page';
import { MYSQL_SOURCE, POSTGRES_SOURCE, type SourceDatabase } from '../../support/sources';
import { uniqueId, uniqueName } from '../../support/unique';

// Locators follow the visible English copy (apps/web/src/locales/en/connections.json).
//
// The connection list is shared by every spec that runs in parallel (the API
// suite creates connections too), so these specs never count rows or read the
// totals. Each one finds its own connection by a unique name, creates it
// through the API or the form, and leaves none behind: `createConnection` and
// `deleteConnectionAfterTest` delete by name even when the test fails.

/** The browser's own confirmation, which only non-PROD connections still use. */
const CONFIRM_DELETE = 'Are you sure you want to permanently delete this connection?';

/** What the form needs for a valid connection, as a person would type it. */
function formValues(
  overrides: Partial<ConnectionFormValues> = {},
  source: SourceDatabase = POSTGRES_SOURCE,
): ConnectionFormValues {
  const { dbType, host, port, database, username, password } = source;
  return {
    name: uniqueName('ui'),
    dbType,
    environment: 'dev',
    host,
    port: String(port),
    database,
    username,
    password,
    ...overrides,
  };
}

/** Counts the requests that would write or test a connection, to show a form sent none. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET' && pathname.startsWith('/api/connections')) {
      writes.push(`${request.method()} ${pathname}`);
    }
  });
  return writes;
}

test.describe('empty state', () => {
  test('invites the admin to create the first connection', async ({ page }) => {
    // The shared stack may hold connections made by other specs, so the empty
    // list is canned. Only GET is replaced; the form's POST still reaches the API.
    await mockApiGet(page, 'connections', []);
    const connections = new ConnectionsPage(page);
    await connections.goto();

    await expect(connections.heading).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No connections' })).toBeVisible();
    await expect(
      page.getByText('Create your first connection to start managing databases.'),
    ).toBeVisible();

    await connections.createButton.click();
    await expect(page.getByText('New connection', { exact: true })).toBeVisible();
    await expect(connections.form().createSubmit).toBeVisible();
  });
});

test.describe('creation form', () => {
  test('opens and closes without creating anything', async ({ page }) => {
    const writes = recordWrites(page);
    const connections = new ConnectionsPage(page);
    const form = connections.form();
    await connections.goto();

    await connections.createButton.click();
    await expect(page.getByText('New connection', { exact: true })).toBeVisible();
    await expect(form.password).toHaveAttribute('type', 'password');

    await form.cancelButton.click();
    await expect(form.root).toBeHidden();
    expect(writes).toEqual([]);
  });

  const REQUIRED_FIELDS: Array<{ field: keyof ConnectionFormValues; message: string }> = [
    { field: 'name', message: 'Name is required' },
    { field: 'host', message: 'Host is required' },
    { field: 'port', message: 'Port must be a valid number' },
    { field: 'database', message: 'Database is required' },
    { field: 'username', message: 'Username is required' },
    { field: 'password', message: 'Password is required' },
  ];

  for (const { field, message } of REQUIRED_FIELDS) {
    test(`asks for the ${field} before creating`, async ({ page }) => {
      const writes = recordWrites(page);
      const connections = new ConnectionsPage(page);
      const form = connections.form();
      await connections.goto();
      await connections.createButton.click();

      await form.fill(formValues({ [field]: '' }));
      await form.createSubmit.click();

      await expect(form.root.getByText(message)).toBeVisible();
      expect(writes).toEqual([]);
    });
  }

  test('asks for the host before testing an empty form', async ({ page }) => {
    const writes = recordWrites(page);
    const connections = new ConnectionsPage(page);
    const form = connections.form();
    await connections.goto();
    await connections.createButton.click();

    await form.testButton.click();

    await expect(form.root.getByText('Enter the host to test the connection')).toBeVisible();
    expect(writes).toEqual([]);
  });

  test('asks for the password before testing', async ({ page }) => {
    const writes = recordWrites(page);
    const connections = new ConnectionsPage(page);
    const form = connections.form();
    await connections.goto();
    await connections.createButton.click();

    await form.fill(formValues({ password: '' }));
    await form.testButton.click();

    await expect(form.root.getByText('Enter the password to test the connection')).toBeVisible();
    expect(writes).toEqual([]);
  });

  const SOURCES = [
    { label: 'PostgreSQL', source: POSTGRES_SOURCE, environment: 'qa', shown: 'QA' },
    { label: 'MySQL', source: MYSQL_SOURCE, environment: 'prod', shown: 'Production' },
  ] as const;

  for (const { label, source, environment, shown } of SOURCES) {
    test(`creates a ${label} connection in ${environment} and shows it in the table`, async ({
      page,
      findConnection,
      deleteConnectionAfterTest,
    }) => {
      const name = uniqueName('ui-create');
      deleteConnectionAfterTest(name);
      const connections = new ConnectionsPage(page);
      const form = connections.form();
      await connections.goto();
      await connections.createButton.click();

      await form.fill(formValues({ name, environment }, source));
      await form.createSubmit.click();

      await expect(page.getByText('Connection created successfully')).toBeVisible();
      await expect(form.root).toBeHidden();
      const row = connections.row(name);
      for (const text of [source.dbType, source.host, String(source.port), source.database, shown, 'Active']) {
        await expect(row).toContainText(text);
      }

      // It is stored, with what was typed.
      const saved = await findConnection(name);
      expect(saved, 'the connection was saved').toBeDefined();
      expect(saved).toMatchObject({
        name,
        dbType: source.dbType,
        environment,
        host: source.host,
        port: source.port,
        database: source.database,
        username: source.username,
        isActive: true,
      });
      // The password goes to the server and is never shown back.
      await expect(page.locator('body')).not.toContainText(source.password);
    });
  }
});

test.describe('testing a connection', () => {
  test('reports success for a reachable database from the form', async ({ page }) => {
    const connections = new ConnectionsPage(page);
    const form = connections.form();
    await connections.goto();
    await connections.createButton.click();

    await form.fill(formValues());
    await form.testButton.click();

    await expect(form.root.getByText(/Connected · \d+ms/)).toBeVisible();
    // Testing is not saving: the form is still open and nothing was created.
    await expect(form.createSubmit).toBeEnabled();
  });

  test('reports a wrong password from the form without crashing', async ({ page }) => {
    const connections = new ConnectionsPage(page);
    const form = connections.form();
    await connections.goto();
    await connections.createButton.click();

    await form.fill(formValues({ password: `wrong-${uniqueId()}` }));
    await form.testButton.click();

    await expect(form.root.getByText(/^Error: .*password authentication failed/)).toBeVisible();
    await expect(form.root.getByText(/Connected/)).toBeHidden();
    await expect(form.testButton).toBeEnabled();
    await expect(form.createSubmit).toBeEnabled();
  });

  test('reports success for a saved connection from its row', async ({ page, createConnection }) => {
    const { input } = await createConnection();
    const connections = new ConnectionsPage(page);
    await connections.goto();

    await connections.row(input.name).getByRole('button', { name: 'Test connection' }).click();

    await expect(connections.row(input.name)).toContainText(/Connected · \d+ms/);
    await expect(page.getByText('Connection successful', { exact: true })).toBeVisible();
  });

  test('reports a wrong password for a saved connection from its row', async ({
    page,
    createConnection,
  }) => {
    const { input } = await createConnection({ password: `wrong-${uniqueId()}` });
    const connections = new ConnectionsPage(page);
    await connections.goto();

    await connections.row(input.name).getByRole('button', { name: 'Test connection' }).click();

    await expect(connections.row(input.name)).toContainText(/Error: .*password authentication failed/);
    await expect(page.getByText('Connection failed', { exact: true })).toBeVisible();
    await expect(connections.row(input.name)).not.toContainText('Connected');
  });

  // Regression test for D10 (fixed): the success toast used to build its
  // description in Spanish ("Latencia: 5ms") regardless of the interface
  // language. It now uses the `toast.testSuccess.latency` string, so the
  // English interface says "Latency: 5ms".
  test('words the latency of a successful test in the interface language', async ({
    page,
    createConnection,
  }) => {
    const { input } = await createConnection();
    const connections = new ConnectionsPage(page);
    await connections.goto();

    await connections.row(input.name).getByRole('button', { name: 'Test connection' }).click();

    await expect(page.getByText('Connection successful', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Latency: \d+ms$/)).toBeVisible();
  });
});

test.describe('existing connections', () => {
  test('filters the table by name', async ({ page, createConnection }) => {
    const wanted = await createConnection();
    const other = await createConnection();
    const connections = new ConnectionsPage(page);
    await connections.goto();
    await expect(connections.row(other.input.name)).toBeVisible();

    await connections.search.fill(wanted.input.name);

    await expect(connections.row(wanted.input.name)).toBeVisible();
    await expect(connections.row(other.input.name)).toHaveCount(0);
  });

  test('edits a connection and keeps its password', async ({
    page,
    adminApi,
    createConnection,
  }) => {
    const { input, connection } = await createConnection({ environment: 'dev' });
    const connections = new ConnectionsPage(page);
    const form = connections.form();
    await connections.goto();

    await connections.row(input.name).getByRole('button', { name: 'Edit' }).click();

    // The form starts from the saved values. The password is never sent to the
    // browser, so its field is empty and says that blank keeps the stored one.
    await expect(page.getByText('Edit connection', { exact: true })).toBeVisible();
    await expect(form.name).toHaveValue(input.name);
    await expect(form.host).toHaveValue(input.host);
    await expect(form.port).toHaveValue(String(input.port));
    await expect(form.database).toHaveValue(input.database);
    await expect(form.username).toHaveValue(input.username);
    await expect(form.password).toHaveValue('');
    await expect(form.password).toHaveAttribute('placeholder', 'Leave blank to keep current');
    // The API refuses to move a connection to PROD, so editing never offers it.
    await expect(form.environment.locator('option[value="prod"]')).toHaveCount(0);

    const renamed = uniqueName('ui-renamed');
    await form.fill({ name: renamed, environment: 'qa' });
    await form.saveSubmit.click();

    await expect(page.getByText('Connection updated successfully')).toBeVisible();
    await expect(connections.row(renamed)).toContainText('QA');
    await expect(connections.row(input.name)).toHaveCount(0);

    // Saved on the server, and the stored password still opens the database.
    const saved = await expectSuccessEnvelope<{ name: string; environment: string }>(
      await adminApi.get(`connections/${connection.id}`),
    );
    expect(saved).toMatchObject({ name: renamed, environment: 'qa' });
    const tested = await expectSuccessEnvelope<{ success: boolean }>(
      await adminApi.post(`connections/${connection.id}/test`),
      201,
    );
    expect(tested.success).toBe(true);
    await expect(page.locator('body')).not.toContainText(input.password);
  });

  test('deletes a connection after the user confirms', async ({
    page,
    createConnection,
    findConnection,
  }) => {
    const { input } = await createConnection();
    const connections = new ConnectionsPage(page);
    await connections.goto();
    const row = connections.row(input.name);
    await expect(row).toBeVisible();
    const asked = new Promise<string>((resolve) => {
      page.once('dialog', async (dialog) => {
        resolve(dialog.message());
        await dialog.accept();
      });
    });

    await row.getByRole('button', { name: 'Delete' }).click();

    expect(await asked).toBe(CONFIRM_DELETE);
    await expect(page.getByText('Connection deleted', { exact: true })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await findConnection(input.name)).toBeUndefined();
  });

  test('keeps a connection when the user cancels the confirmation', async ({
    page,
    createConnection,
    findConnection,
  }) => {
    const { input } = await createConnection();
    const connections = new ConnectionsPage(page);
    await connections.goto();
    const row = connections.row(input.name);
    await expect(row).toBeVisible();
    const asked = new Promise<string>((resolve) => {
      page.once('dialog', async (dialog) => {
        resolve(dialog.message());
        await dialog.dismiss();
      });
    });

    await row.getByRole('button', { name: 'Delete' }).click();

    expect(await asked).toBe(CONFIRM_DELETE);
    await expect(row).toBeVisible();
    await expect(page.getByText('Connection deleted', { exact: true })).toBeHidden();
    expect(await findConnection(input.name)).toBeDefined();
  });
});

// A PROD connection cannot be edited, and deleting one takes its exact name and
// the admin's password instead of the browser's confirmation.
test.describe('production connections', () => {
  /** Records (and dismisses) any browser confirmation, to show that none was asked. */
  function recordNativeConfirms(page: Page): string[] {
    const asked: string[] = [];
    page.on('dialog', async (dialog) => {
      asked.push(dialog.message());
      await dialog.dismiss();
    });
    return asked;
  }

  test('offers no Edit for a production connection', async ({ page, createConnection }) => {
    const { input } = await createConnection({ environment: 'prod' });
    const connections = new ConnectionsPage(page);
    await connections.goto();
    const row = connections.row(input.name);

    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });

  test('deletes a production connection once its name and the password are given', async ({
    page,
    createConnection,
    findConnection,
  }) => {
    const { input, connection } = await createConnection({ environment: 'prod' });
    const asked = recordNativeConfirms(page);
    const connections = new ConnectionsPage(page);
    await connections.goto();
    const row = connections.row(input.name);

    await row.getByRole('button', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete production connection' });
    const confirm = dialog.getByRole('button', { name: 'Delete connection' });
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(`Type ${input.name} to confirm`).fill(input.name);
    await expect(confirm).toBeDisabled();
    const password = dialog.getByLabel('Your password');
    await expect(password).toHaveAttribute('type', 'password');
    await password.fill(adminCredentials().password);
    await expect(confirm).toBeEnabled();

    const sent = page.waitForRequest(
      (request) =>
        request.method() === 'DELETE' &&
        new URL(request.url()).pathname === `/api/connections/${connection.id}`,
    );
    await confirm.click();

    expect((await sent).postDataJSON()).toEqual({
      confirmName: input.name,
      password: adminCredentials().password,
    });
    await expect(page.getByText('Connection deleted', { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
    expect(await findConnection(input.name)).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test('keeps the dialog open and shows why when the API refuses', async ({
    page,
    createConnection,
    findConnection,
  }) => {
    const { input, connection } = await createConnection({ environment: 'prod' });
    // The refusal is canned: the API counts failed password confirmations per
    // admin, and the seeded admin that this browser signs in as is shared by
    // every run and every teardown, so it must never collect them.
    const path = `/api/connections/${connection.id}`;
    const message = 'La confirmación de contraseña falló.';
    await page.route(
      (url) => url.pathname === path,
      (route) => {
        if (route.request().method() !== 'DELETE') {
          return route.fallback();
        }
        return route.fulfill({
          status: 403,
          json: {
            error: { code: 'ForbiddenException', message, statusCode: 403 },
            timestamp: new Date().toISOString(),
            path,
          },
        });
      },
    );
    const connections = new ConnectionsPage(page);
    await connections.goto();
    const row = connections.row(input.name);

    await row.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete production connection' });
    await dialog.getByLabel(`Type ${input.name} to confirm`).fill(input.name);
    await dialog.getByLabel('Your password').fill(`wrong-${uniqueId()}`);
    await dialog.getByRole('button', { name: 'Delete connection' }).click();

    await expect(dialog.getByRole('alert')).toHaveText(message);
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/Request failed with status code/)).toHaveCount(0);

    // Closing forgets what was typed and leaves the connection in place.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog.getByLabel('Your password')).toHaveValue('');
    expect(await findConnection(input.name)).toBeDefined();
  });
});
