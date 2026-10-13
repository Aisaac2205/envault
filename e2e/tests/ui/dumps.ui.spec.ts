import { DumpsPage } from '../../support/pages/dumps-page';
import { expect, test } from '../../support/pipeline-fixtures';
import type { BackupJob } from '../../support/jobs';

// Locators follow the visible English copy (apps/web/src/locales/en/dumps.json).
//
// The one journey that needs the whole pipeline behind the screen: a person
// starts a backup from the Dumps page and, once the worker has finished it, the
// history shows it as completed. The page does not poll, so the history is
// reloaded after the job is done.

test('starts a backup from the Dumps page and shows it completed', async ({
  page,
  newDatabase,
  createConnection,
  adminApi,
  jobs,
}) => {
  const database = await newDatabase('postgres', 'seeded');
  const { connection } = await createConnection({ ...database.settings, environment: 'prod' });
  const dumps = new DumpsPage(page);

  await dumps.goto();
  await expect(dumps.heading).toBeVisible();
  await dumps.createBackup(connection.name);
  await expect(page.getByText('Backup created successfully')).toBeVisible();

  // The screen has no job id to give; the history of this connection has the one backup.
  const history = await adminApi.get(`backups/history?connectionId=${connection.id}`);
  const [created]: BackupJob[] = (await history.json()).data.data;
  expect(created, 'the backup the page created').toBeDefined();
  expect(created.triggeredBy).not.toBe('system-cronjob');
  jobs.track(created);
  await jobs.waitForBackup(created.id);

  await page.reload();
  await dumps.filterByConnection(connection.name);
  await expect(dumps.row(connection.name)).toContainText('Completed');
  await expect(dumps.row(connection.name)).toContainText('Manual');
});
