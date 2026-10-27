import { lockPostgresTable, withPostgres } from '../../support/databases';
import { expect, test } from '../../support/pipeline-fixtures';

// A restore into PostgreSQL drops and recreates the target's tables in one
// transaction (pg_restore --clean --single-transaction), so a session that holds
// a lock on one of them keeps the restore waiting. Without a bound it waits for
// as long as the other session holds the lock, and the restore queue (one job at
// a time) waits with it. The API cancels a statement that has waited on a lock
// for RESTORE_LOCK_WAIT_TIMEOUT_MS (5 s in this stack, 30 s by default), which
// rolls the transaction back and fails the job. (A lock_timeout set on the
// session would do nothing: pg_restore resets it to 0 itself.) The MySQL
// counterpart lives in restore-mysql-schema-objects.pipeline.spec.ts.

const TARGET_ONLY_ROW = 'target-only';

/**
 * A probe that waited for nothing would prove nothing: the table must really be
 * locked, with the same error the restore will get (lock_timeout).
 */
async function expectTableLocked(database: string): Promise<void> {
  await withPostgres(database, async (probe) => {
    await probe.query("SET lock_timeout = '200ms'");
    await expect(probe.query('SELECT 1 FROM e2e_items LIMIT 1')).rejects.toThrow(/lock timeout/);
  });
}

test.describe('PostgreSQL restore lock wait', () => {
  test('fails within the lock bound and leaves the target unchanged while another session holds a lock', async ({
    backedUp,
    newDatabase,
    createConnection,
    jobs,
  }) => {
    const { backup, fingerprint: sourceFingerprint } = await backedUp('postgres');

    // A target that already holds data of its own, so "unchanged" can be told
    // apart from "restored": the dump has none of it.
    const target = await newDatabase('postgres', 'seeded');
    await withPostgres(target.name, (client) =>
      client.query('INSERT INTO e2e_items (id, label, amount, note) VALUES (-1, $1, 1.00, NULL)', [
        TARGET_ONLY_ROW,
      ]),
    );
    const before = await target.engine.inspect(target.name);
    expect(before, 'scenario input: the target differs from the source').not.toEqual(sourceFingerprint);

    const { connection } = await createConnection({ ...target.settings, environment: 'dev' });
    const request = { sourceBackupId: backup.id, targetConnectionId: connection.id };

    const release = await lockPostgresTable(target.name);
    try {
      await expectTableLocked(target.name);

      const { jobId } = await jobs.startRestore(request);
      // Without the bound the restore waits for the lock indefinitely, so ending
      // inside the job timeout is the proof that it is bounded.
      const failed = await jobs.waitForRestore(jobId, {
        until: (job) => job.status === 'failed' || job.status === 'completed',
        failFast: false,
        description: 'finish while another session held a lock on the target',
      });
      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toMatch(/waiting for a lock on the target database/);
      expect(failed.errorMessage).toContain('The target was left unchanged');
    } finally {
      await release();
    }

    // The lock is gone, so the target can be read again: nothing was lost and
    // nothing of the dump got in.
    expect(await target.engine.inspect(target.name), 'the target keeps its own data').toEqual(before);

    // The queue is free again and the same restore now goes through.
    const restore = await jobs.restore(request);
    expect(restore).toMatchObject({ status: 'completed', errorMessage: null });
    expect(await target.engine.inspect(target.name)).toEqual(sourceFingerprint);
  });
});
