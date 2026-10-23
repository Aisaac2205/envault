import { DumpsPage } from '../../support/pages/dumps-page';
import { expect, test } from '../../support/pipeline-fixtures';
import { JOB_TIMEOUT_MS, type BackupJob } from '../../support/jobs';

// Locators follow the visible English copy (apps/web/src/locales/en/dumps.json).
//
// The one journey that needs the whole pipeline behind the screen: a person
// starts a backup from the Dumps page, is told it was queued, and, once the
// worker has finished it, sees the completion toast and the row turn completed
// without reloading: the page follows the job's SSE stream and refreshes the
// history when the stream reports the end.

test('starts a backup from the Dumps page and shows it completed', async ({
  page,
  newDatabase,
  createConnection,
  adminApi,
  jobs,
}) => {
  // The backup runs through the real worker; leave it the same budget as the API wait.
  test.setTimeout(JOB_TIMEOUT_MS + 30_000);
  const database = await newDatabase('postgres', 'seeded');
  const { connection } = await createConnection({ ...database.settings, environment: 'prod' });
  const dumps = new DumpsPage(page);

  await dumps.goto();
  await expect(dumps.heading).toBeVisible();
  await dumps.createBackup(connection.name);
  await expect(page.getByText('Backup queued', { exact: true })).toBeVisible();

  // The screen has no job id to give; the history of this connection has the one backup.
  const history = await adminApi.get(`backups/history?connectionId=${connection.id}`);
  const [created]: BackupJob[] = (await history.json()).data.data;
  expect(created, 'the backup the page created').toBeDefined();
  expect(created.triggeredBy).not.toBe('system-cronjob');
  jobs.track(created);

  await expect(page.getByText('Backup completed', { exact: true })).toBeVisible({
    timeout: JOB_TIMEOUT_MS,
  });
  // Safety net: the API agrees the job is done (resolves at once by now).
  await jobs.waitForBackup(created.id);

  // No reload: the history was refreshed when the stream reported completion.
  await dumps.filterByConnection(connection.name);
  await expect(dumps.row(connection.name)).toContainText('Completed');
  await expect(dumps.row(connection.name)).toContainText('Manual');
});
