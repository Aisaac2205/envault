import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { JOB_TIMEOUT_MS, type BackupJob } from '../../support/jobs';
import { expect, test } from '../../support/pipeline-fixtures';
import { listObjects } from '../../support/storage';
import { MYSQL_SOURCE, POSTGRES_SOURCE, type SourceDatabase } from '../../support/sources';
import { uniqueName } from '../../support/unique';

// The API saves a connection without opening it, so a `prod` connection with a
// bad address or password is accepted and the problem only shows when the
// worker tries to dump it. The job has to end as `failed`, say why, and leave
// no object in storage. A failing backup is attempted twice, 5 s apart, so
// these tests take a few seconds each.

const BROKEN_SOURCES: [string, SourceDatabase][] = [
  ['a wrong PostgreSQL password', { ...POSTGRES_SOURCE, password: 'not-the-password' }],
  ['a wrong MySQL password', { ...MYSQL_SOURCE, password: 'not-the-password' }],
  ['a PostgreSQL host that does not resolve', { ...POSTGRES_SOURCE, host: 'no-such-host.invalid' }],
  ['a MySQL database that does not exist', { ...MYSQL_SOURCE, database: 'e2e_no_such_database' }],
];

for (const [title, source] of BROKEN_SOURCES) {
  test(`ends failed, with its error and no object, for ${title}`, async ({
    createConnection,
    jobs,
    adminApi,
  }) => {
    test.setTimeout(2 * JOB_TIMEOUT_MS + 30_000);
    const { connection } = await createConnection({
      ...source,
      name: uniqueName('broken'),
      environment: 'prod',
    });

    const { jobId, fileKey } = await jobs.startBackup(connection.id);

    // The first attempt fails within milliseconds and the job is already
    // reported `failed`, but the queue retries it after 5 s and that attempt
    // rewrites the row (a retried job should not show as failed in between; it
    // is reported as an observation, with no spec of its own). The failure is
    // final once a second attempt has started and failed, i.e. its start is
    // later than the first failure's end.
    let firstFailureEndedAt: number | undefined;
    const failedForGood = (job: BackupJob): boolean => {
      if (job.status !== 'failed') {
        return false;
      }
      firstFailureEndedAt ??= Date.parse(job.completedAt!);
      return Date.parse(job.startedAt!) > firstFailureEndedAt;
    };
    const failed = await jobs.waitForBackup(jobId, {
      failFast: false,
      until: failedForGood,
      description: 'fail for good after its retry',
      timeoutMs: JOB_TIMEOUT_MS * 2,
    });

    expect(failed).toMatchObject({
      status: 'failed',
      connectionId: connection.id,
      fileKey,
      sha256: null,
      bytes: null,
      fileSizeMb: null,
      errorMessage: expect.stringMatching(/\S/),
    });
    expect(failed.completedAt).not.toBeNull();
    expect(failed.errorMessage).not.toContain(source.password);

    // Nothing reached storage, neither a dump nor a manifest.
    expect(await listObjects(`${connection.slug}/`)).toEqual([]);

    // The failure shows in the history, and there is nothing to download or restore.
    const history = await expectSuccessEnvelope<{ data: BackupJob[]; total: number }>(
      await adminApi.get(`backups/history?connectionId=${connection.id}&status=failed`),
    );
    expect(history.data.map(({ id }) => id)).toEqual([jobId]);
    await expectErrorEnvelope(await adminApi.post(`backups/${jobId}/download-url`), 400);

    const { connection: target } = await createConnection({ environment: 'dev' });
    await expectErrorEnvelope(
      await adminApi.post('restores', {
        data: { sourceBackupId: jobId, targetConnectionId: target.id, isDryRun: true },
      }),
      403,
    );
  });
}
