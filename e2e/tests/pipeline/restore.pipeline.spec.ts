import { expect, test } from '../../support/pipeline-fixtures';
import { EMPTY_DATABASE, SEEDED_ROW_COUNTS, SEED_TABLES } from '../../support/seed-data';

// A restore reads a dump back from object storage and loads it into a target
// database with `pg_restore` or `mysql`. The proof is in the target: after the
// job completes, a database that was empty holds the same tables, constraints,
// indexes and rows as the one that was backed up, compared through a row count
// and a SHA-256 over every row (see support/seed-data.ts).

// The API image ships `pg_restore` 18, which cannot restore into a server older
// than 17: it aborts on `SET transaction_timeout`. See D1 in docs/en/e2e-testing.md.
const POSTGRES_17 = 170_000;
const NEEDS_POSTGRES_17 =
  'D1: pg_restore 18 cannot restore into a PostgreSQL older than 17. ' +
  'Use the default E2E_PG_IMAGE (postgres:18-alpine) to run this test.';

const RESTORES = [
  { dbType: 'postgres', environment: 'dev', title: 'PostgreSQL into a dev target' },
  { dbType: 'mysql', environment: 'dev', title: 'MySQL into a dev target' },
  { dbType: 'mysql', environment: 'qa', title: 'MySQL into a qa target' },
] as const;

test.describe('restore', () => {
  for (const { dbType, environment, title } of RESTORES) {
    test(`loads a backup of ${title} with the data of the source`, async ({
      backedUp,
      restoreTarget,
      jobs,
      postgresVersion,
    }) => {
      test.skip(dbType === 'postgres' && postgresVersion < POSTGRES_17, NEEDS_POSTGRES_17);
      const { backup, fingerprint } = await backedUp(dbType);
      const { database, connection } = await restoreTarget(dbType, environment);

      // The proof below means nothing unless the target starts empty.
      expect(await database.engine.inspect(database.name)).toEqual(EMPTY_DATABASE);

      const restore = await jobs.restore({
        sourceBackupId: backup.id,
        targetConnectionId: connection.id,
      });
      expect(restore).toMatchObject({
        status: 'completed',
        isDryRun: false,
        sourceBackupId: backup.id,
        r2Key: null,
        targetConnectionId: connection.id,
        targetEnvironment: environment,
        errorMessage: null,
      });
      expect(Date.parse(restore.startedAt!)).toBeLessThanOrEqual(Date.parse(restore.completedAt!));

      const restored = await database.engine.inspect(database.name);
      expect(restored.rows).toEqual(SEEDED_ROW_COUNTS);
      expect(restored).toEqual(fingerprint);
    });
  }

  test('loads a dump named by its object key instead of by its backup', async ({
    backedUp,
    restoreTarget,
    jobs,
  }) => {
    const { backup, fingerprint } = await backedUp('mysql');
    const { database, connection } = await restoreTarget('mysql', 'dev');

    const restore = await jobs.restore({ r2Key: backup.fileKey!, targetConnectionId: connection.id });

    expect(restore).toMatchObject({ status: 'completed', r2Key: backup.fileKey, sourceBackupId: null });
    expect(await database.engine.inspect(database.name)).toEqual(fingerprint);
  });
});

test.describe('dry run', () => {
  const ENGINES = [
    { dbType: 'postgres', title: 'PostgreSQL' },
    { dbType: 'mysql', title: 'MySQL' },
  ] as const;

  // Table names come back schema-qualified on PostgreSQL (`public.e2e_items`)
  // and bare on MySQL; the table is what matters here.
  const tableNames = (tables: { name: string }[]): string[] =>
    tables.map(({ name }) => name.split('.').pop()!).sort();

  for (const { dbType, title } of ENGINES) {
    test(`reports what a ${title} restore would do and changes nothing`, async ({
      backedUp,
      restoreTarget,
      jobs,
    }) => {
      const { backup, connection: sourceConnection, database: source } = await backedUp(dbType);
      const { database: target, connection: targetConnection } = await restoreTarget(dbType, 'dev');

      const { jobId, dryRunResult } = await jobs.startRestore({
        sourceBackupId: backup.id,
        targetConnectionId: targetConnection.id,
        isDryRun: true,
      });

      expect(dryRunResult).toMatchObject({
        manifestAvailable: true,
        sourceConnection: {
          name: sourceConnection.name,
          database: source.name,
          environment: 'prod',
          dbType,
        },
        targetConnection: {
          name: targetConnection.name,
          database: target.name,
          environment: 'dev',
          dbType,
        },
      });
      // The plan: both source tables would be added to an empty target.
      expect(dryRunResult!.source!.tableCount).toBe(SEED_TABLES.length);
      expect(tableNames(dryRunResult!.source!.tables)).toEqual([...SEED_TABLES]);
      expect(dryRunResult!.target).toEqual({ tableCount: 0, estimatedRows: 0, tables: [] });
      expect(dryRunResult!.diff!.removed).toEqual([]);
      expect(dryRunResult!.diff!.common).toEqual([]);
      expect(dryRunResult!.diff!.added.map((name) => name.split('.').pop()).sort()).toEqual([
        ...SEED_TABLES,
      ]);

      // A dry run is recorded as a finished job that never ran a restore.
      const job = await jobs.waitForRestore(jobId);
      expect(job).toMatchObject({ isDryRun: true, status: 'completed', errorMessage: null });
      expect(await target.engine.inspect(target.name)).toEqual(EMPTY_DATABASE);
    });
  }

  test('finds the manifest of a dump named by its object key', async ({
    backedUp,
    restoreTarget,
    jobs,
  }) => {
    const { backup } = await backedUp('mysql');
    const { connection } = await restoreTarget('mysql', 'dev');

    const { dryRunResult } = await jobs.startRestore({
      r2Key: backup.fileKey!,
      targetConnectionId: connection.id,
      isDryRun: true,
    });

    // The source side of the plan comes from the manifest stored next to the dump.
    expect(dryRunResult).toMatchObject({ manifestAvailable: true });
    expect(dryRunResult!.source!.tableCount).toBe(SEED_TABLES.length);
  });
});

test.describe('restore on a PostgreSQL older than 17', () => {
  // Known defect D1. The spec states the behavior as it is today and runs only
  // against an old server; it starts failing, with "restore completed", when the
  // API can restore into old servers, which is the signal to delete it.
  test(
    'D1: fails on transaction_timeout and leaves the target empty',
    {
      annotation: {
        type: 'known-defect',
        description: 'D1: pg_restore 18 cannot restore into PostgreSQL older than 17',
      },
    },
    async ({ backedUp, restoreTarget, jobs, postgresVersion }) => {
      test.skip(
        postgresVersion >= POSTGRES_17,
        'D1 only shows when the source PostgreSQL is older than 17. ' +
          'Start the stack with E2E_PG_IMAGE=postgres:16-alpine to run this test.',
      );
      const { backup } = await backedUp('postgres');
      const { database, connection } = await restoreTarget('postgres', 'dev');

      const { jobId } = await jobs.startRestore({
        sourceBackupId: backup.id,
        targetConnectionId: connection.id,
      });
      const restore = await jobs.waitForRestore(jobId, {
        failFast: false,
        until: (job) => job.status === 'failed',
        description: 'fail',
      });

      expect(restore.errorMessage).toContain('transaction_timeout');
      // pg_restore runs in a single transaction, so nothing was half-loaded.
      expect(await database.engine.inspect(database.name)).toEqual(EMPTY_DATABASE);
    },
  );
});
