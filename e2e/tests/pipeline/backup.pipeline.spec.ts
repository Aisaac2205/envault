import { lockPostgresTable } from '../../support/databases';
import { expectSuccessEnvelope } from '../../support/envelope';
import { manifestKey, type BackupJob } from '../../support/jobs';
import { expect, test } from '../../support/pipeline-fixtures';
import { SEED_TABLES } from '../../support/seed-data';
import { downloadSignedUrl, listObjects, readObject } from '../../support/storage';

// A backup takes the whole pipeline: HTTP request, a BullMQ job, `pg_dump` or
// `mysqldump` inside the API container, an upload to object storage (MinIO
// here, Cloudflare R2 in production) and a manifest written next to the dump.
// Each test seeds a database of its own, backs it up through the API and then
// looks at the result from the outside: the job row, the object store, and the
// dump downloaded back through a signed URL. The databases and the dumps are
// removed when the test ends.

const ENGINES = [
  { dbType: 'postgres', title: 'PostgreSQL' },
  { dbType: 'mysql', title: 'MySQL' },
] as const;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const time = (iso: string | null): number => Date.parse(iso ?? '');

for (const { dbType, title } of ENGINES) {
  test.describe(`${title} backup`, () => {
    test('completes with the size, digest and timings of the dump', async ({ backedUp }) => {
      const { connection, backup } = await backedUp(dbType);

      expect(backup).toMatchObject({
        status: 'completed',
        connectionId: connection.id,
        connectionName: connection.name,
        environment: 'prod',
        dbType,
        category: 'manual',
        errorMessage: null,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(backup.fileKey).toMatch(new RegExp(`^${connection.slug}/manual/[^/]+\\.dump$`));
      expect(backup.bytes).toBeGreaterThan(0);
      expect(backup.fileSizeMb).toBeCloseTo(backup.bytes! / (1024 * 1024), 9);

      // The row is created, then picked up by a worker, then finished.
      expect(time(backup.createdAt)).toBeLessThanOrEqual(time(backup.startedAt));
      expect(time(backup.startedAt)).toBeLessThanOrEqual(time(backup.completedAt));
    });

    test('serves a dump that matches its recorded digest and size', async ({ backedUp, adminApi }) => {
      const { backup } = await backedUp(dbType);

      const response = await adminApi.post(`backups/${backup.id}/download-url`);
      expect(response.ok(), await response.text()).toBe(true);
      const { url, fileKey } = (await response.json()).data;
      expect(fileKey).toBe(backup.fileKey);

      // What comes out of storage is byte for byte what the worker recorded.
      expect(await downloadSignedUrl(url)).toEqual({
        status: 200,
        bytes: backup.bytes,
        sha256: backup.sha256,
      });
    });

    test('stores the dump and a manifest that describes the run', async ({ backedUp }) => {
      const { database, connection, backup } = await backedUp(dbType);
      const fileKey = backup.fileKey!;

      // Exactly the dump and its manifest: nothing else was written for this connection.
      expect(await listObjects(`${connection.slug}/`)).toEqual([fileKey, manifestKey(fileKey)].sort());

      const stored = await readObject(manifestKey(fileKey));
      expect(stored, 'manifest object').not.toBeNull();
      const manifest = JSON.parse(stored!);

      expect(manifest).toEqual({
        version: 2,
        createdAt: expect.stringMatching(ISO_TIMESTAMP),
        dbType,
        database: database.name,
        sha256: backup.sha256,
        bytes: backup.bytes,
        compression: 'none',
        source: {
          serverVersion: expect.stringMatching(/\S/),
          tableCount: SEED_TABLES.length,
          estimatedRows: expect.any(Number),
          tables: expect.any(Array),
        },
      });
      expect(time(manifest.createdAt)).toBeGreaterThanOrEqual(time(backup.createdAt));
      expect(time(manifest.createdAt)).toBeLessThanOrEqual(time(backup.completedAt));

      // Row counts in the manifest are the database's own estimates, so only
      // their shape is pinned: one entry per table, and a total that adds up.
      const tables: { name: string; estimatedRows: number }[] = manifest.source.tables;
      expect(tables.map(({ name }) => name.split('.').pop()).sort()).toEqual([...SEED_TABLES]);
      for (const { estimatedRows } of tables) {
        expect(Number.isInteger(estimatedRows) && estimatedRows >= 0).toBe(true);
      }
      expect(manifest.source.estimatedRows).toBe(
        tables.reduce((sum, { estimatedRows }) => sum + estimatedRows, 0),
      );
    });

    test('lists the dump in the storage listings', async ({ backedUp, adminApi }) => {
      const { connection, backup } = await backedUp(dbType);

      const enriched = await expectSuccessEnvelope<Record<string, unknown>[]>(
        await adminApi.get(`backups/r2/enriched?connectionSlug=${connection.slug}&category=manual`),
      );
      expect(enriched).toEqual([
        {
          key: backup.fileKey,
          size: backup.bytes,
          lastModified: expect.stringMatching(ISO_TIMESTAMP),
          etag: expect.any(String),
          connectionId: connection.id,
          connectionSlug: connection.slug,
          connectionName: connection.name,
          dbType,
          category: 'manual',
          timestamp: expect.any(String),
        },
      ]);

      const all = await expectSuccessEnvelope<{ key: string; size: number }[]>(
        await adminApi.get('backups/r2'),
      );
      expect(all.find(({ key }) => key === backup.fileKey)).toMatchObject({ size: backup.bytes });
    });
  });
}

// The server version in the manifest is read with a different query on each
// engine, so each engine gets its own check.
test.describe('server version in the manifest', () => {
  const recordedVersion = async (fileKey: string | null): Promise<string> =>
    JSON.parse((await readObject(manifestKey(fileKey!)))!).source.serverVersion;

  test('MySQL records the version the source server reports', async ({ backedUp }) => {
    const { database, backup } = await backedUp('mysql');

    expect(await recordedVersion(backup.fileKey)).toBe(await database.engine.serverVersion());
  });

  test('PostgreSQL records the version the source server reports', async ({ backedUp }) => {
    const { database, backup } = await backedUp('postgres');

    expect(await recordedVersion(backup.fileKey)).toBe(await database.engine.serverVersion());
  });
});

test.describe('duplicate requests', () => {
  // The queue keeps one pending backup per connection and category: a request
  // that arrives while one is still waiting gets that backup back instead of a
  // second one. Two requests sent together do not prove it, because the first
  // job can be picked up before the second request is looked at (it happened in
  // about 1 run in 20 here), and then both jobs exist. So the pending backup is
  // made on purpose: a dump held on a table lock keeps the connection busy, the
  // next backup of that connection cannot start and waits in the queue, pending,
  // for 30 s or more, and every request in that window must get it back.
  test('a second request for a connection returns its pending backup', async ({
    newDatabase,
    createConnection,
    jobs,
    adminApi,
  }) => {
    const database = await newDatabase('postgres', 'seeded');
    const { connection } = await createConnection({ ...database.settings, environment: 'prod' });
    const release = await lockPostgresTable(database.name);

    try {
      // The first backup starts and then waits on the lock, holding the connection.
      const running = await jobs.startBackup(connection.id);
      await jobs.waitForBackup(running.jobId, {
        until: (job) => job.status === 'running',
        description: 'start running',
      });

      // The second finds the connection busy and stays pending; later requests get it back.
      const pending = await jobs.startBackup(connection.id);
      expect(pending.jobId).not.toBe(running.jobId);
      expect(pending.status).toBe('pending');
      const repeated = await Promise.all([
        jobs.startBackup(connection.id),
        jobs.startBackup(connection.id),
      ]);
      for (const duplicate of repeated) {
        expect(duplicate).toEqual(pending);
      }

      // Two rows, not four: one running, one pending.
      const history = await expectSuccessEnvelope<{ data: BackupJob[]; total: number }>(
        await adminApi.get(`backups/history?connectionId=${connection.id}`),
      );
      expect(history.total).toBe(2);
      expect(Object.fromEntries(history.data.map(({ id, status }) => [id, status]))).toEqual({
        [running.jobId]: 'running',
        [pending.jobId]: 'pending',
      });

      // Cancelling the pending backup ends it as failed and leaves the running one alone.
      const cancelled = await adminApi.post(`backups/${pending.jobId}/cancel`);
      expect(cancelled.status()).toBe(200);
      const abandoned = await jobs.waitForBackup(pending.jobId, {
        failFast: false,
        until: (job) => job.status === 'failed',
        description: 'be cancelled',
      });
      expect(abandoned.errorMessage).toMatch(/\S/);

      // With the lock gone, the running backup finishes normally.
      await release();
      expect((await jobs.waitForBackup(running.jobId)).status).toBe('completed');
    } finally {
      await release();
    }
  });
});
