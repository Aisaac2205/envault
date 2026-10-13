import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import type { RestoreJob, RestoreRequest } from '../../support/jobs';
import { expect, test } from '../../support/pipeline-fixtures';
import { EMPTY_DATABASE } from '../../support/seed-data';
import { MYSQL_SOURCE } from '../../support/sources';

// What the pipeline refuses to do, and how it says so. Restores are the
// dangerous half (they overwrite a database), so the guard rails that matter
// most are asserted against a real backup: a restore into `prod` is refused
// before anything is read or written, and the refused target stays untouched.
// Requests are dry runs where a request could be accepted, so that a mistake in
// a refusal never turns into a real restore.

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

test.describe('restore requests', () => {
  for (const isDryRun of [false, true]) {
    test(`refuses a target in production, ${isDryRun ? 'dry run included' : 'for a real restore'}`, async ({
      backedUp,
      restoreTarget,
      adminApi,
    }) => {
      const { backup } = await backedUp('mysql');
      const { database, connection } = await restoreTarget('mysql', 'prod');

      const response = await adminApi.post('restores', {
        data: { sourceBackupId: backup.id, targetConnectionId: connection.id, isDryRun },
      });
      await expectErrorEnvelope(response, 403);

      // Refused means no job was created and the target was not touched.
      const restores = await expectSuccessEnvelope<RestoreJob[]>(await adminApi.get('restores'));
      expect(restores.filter(({ targetConnectionId }) => targetConnectionId === connection.id)).toEqual([]);
      expect(await database.engine.inspect(database.name)).toEqual(EMPTY_DATABASE);
    });
  }

  test('refuses a backup of one engine for a target of the other', async ({
    backedUp,
    createConnection,
    adminApi,
  }) => {
    const { backup } = await backedUp('postgres');
    // The target is never opened: the request is refused before that.
    const { connection } = await createConnection({ ...MYSQL_SOURCE, environment: 'dev' });

    await expectErrorEnvelope(
      await adminApi.post('restores', {
        data: { sourceBackupId: backup.id, targetConnectionId: connection.id, isDryRun: true },
      }),
      403,
    );
  });

  test('answers 404 for a target or a source backup that does not exist', async ({
    createConnection,
    adminApi,
  }) => {
    const { connection } = await createConnection();

    await expectErrorEnvelope(
      await adminApi.post('restores', {
        data: { sourceBackupId: UNKNOWN_ID, targetConnectionId: UNKNOWN_ID, isDryRun: true },
      }),
      404,
    );
    await expectErrorEnvelope(
      await adminApi.post('restores', {
        data: { sourceBackupId: UNKNOWN_ID, targetConnectionId: connection.id, isDryRun: true },
      }),
      404,
    );
  });

  const malformed: [string, (valid: RestoreRequest) => object][] = [
    ['an empty body', () => ({})],
    ['a missing target', (valid) => ({ ...valid, targetConnectionId: undefined })],
    ['a target that is not a UUID', (valid) => ({ ...valid, targetConnectionId: 'not-a-uuid' })],
    ['a source backup that is not a UUID', (valid) => ({ ...valid, sourceBackupId: 'not-a-uuid' })],
    ['a missing isDryRun', (valid) => ({ ...valid, isDryRun: undefined })],
    ['an unexpected property', (valid) => ({ ...valid, force: true })],
  ];

  for (const [title, build] of malformed) {
    test(`rejects ${title} with 400`, async ({ adminApi }) => {
      const valid: RestoreRequest = {
        sourceBackupId: UNKNOWN_ID,
        targetConnectionId: UNKNOWN_ID,
        isDryRun: true,
      };

      await expectErrorEnvelope(await adminApi.post('restores', { data: build(valid) }), 400);
    });
  }

  // Known defect D12: a body with neither `sourceBackupId` nor `r2Key` passes
  // validation, and the lookup of "backup undefined" returns a row of the table
  // instead of nothing (TypeORM drops an undefined condition). Depending on what
  // that first row is, the answer is a 403 ("source is not completed") or a 202
  // for a restore from a backup the caller never named. Remove `fail` once the
  // request is rejected with a 400.
  test.fail(
    'rejects a restore that names no source',
    {
      annotation: {
        type: 'known-defect',
        description: 'D12: POST /restores without sourceBackupId or r2Key picks an arbitrary backup',
      },
    },
    async ({ restoreTarget, adminApi }) => {
      const { connection } = await restoreTarget('mysql', 'dev');

      const response = await adminApi.post('restores', {
        data: { targetConnectionId: connection.id, isDryRun: true },
      });

      await expectErrorEnvelope(response, 400);
    },
  );
});

test.describe('backup requests', () => {
  for (const environment of ['dev', 'qa'] as const) {
    test(`refuses a connection in ${environment}: only production is backed up`, async ({
      createConnection,
      adminApi,
    }) => {
      const { connection } = await createConnection({ environment });

      await expectErrorEnvelope(await adminApi.post('backups', { data: { connectionId: connection.id } }), 400);
    });
  }

  test('answers 404 for a connection that does not exist', async ({ adminApi }) => {
    await expectErrorEnvelope(await adminApi.post('backups', { data: { connectionId: UNKNOWN_ID } }), 404);
  });

  const malformed: [string, object][] = [
    ['an empty body', {}],
    ['a connection that is not a UUID', { connectionId: 'not-a-uuid' }],
    ['an unexpected property', { connectionId: UNKNOWN_ID, category: 'daily' }],
  ];

  for (const [title, body] of malformed) {
    test(`rejects ${title} with 400`, async ({ adminApi }) => {
      await expectErrorEnvelope(await adminApi.post('backups', { data: body }), 400);
    });
  }

  test('lists the dumps of a connection only with its slug and a category', async ({ createConnection, adminApi }) => {
    const { connection } = await createConnection({ environment: 'prod' });

    await expectErrorEnvelope(await adminApi.get('backups/r2/enriched'), 400);
    await expectErrorEnvelope(await adminApi.get(`backups/r2/enriched?connectionSlug=${connection.slug}`), 400);
    await expectErrorEnvelope(
      await adminApi.get(`backups/r2/enriched?connectionSlug=${connection.slug}&category=yearly`),
      400,
    );
    await expectErrorEnvelope(
      await adminApi.get('backups/r2/enriched?connectionSlug=no-such-connection&category=manual'),
      404,
    );
    // A connection that never ran a backup has no dumps: an empty list, not an error.
    expect(
      await expectSuccessEnvelope(
        await adminApi.get(`backups/r2/enriched?connectionSlug=${connection.slug}&category=manual`),
      ),
    ).toEqual([]);
  });
});
