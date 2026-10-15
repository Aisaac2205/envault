import { assertOk } from '../../support/api';
import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test as base } from '../../support/fixtures';
import { uniqueName } from '../../support/unique';

// A cronjob is a schedule the API keeps in two places: the row in the database
// and a live job in the API's in-memory scheduler. `nextRunAt` is read from the
// live job, so a non-null `nextRunAt` on an active cronjob is the observable
// sign that the job is really scheduled. The expressions below fire on 1
// January and 1 July only, so no backup runs while the suite does.
const JANUARY_FIRST = '0 0 1 1 *';
const JULY_FIRST = '0 0 1 7 *';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface Cronjob {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string | null;
  cronExpression: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'custom';
  isActive: boolean;
  nextRunAt: string | null;
}

interface CronjobFixtures {
  /**
   * Creates an active `custom` cronjob on a new Postgres connection and deletes
   * both when the test ends, the cronjob first.
   */
  createCronjob: (overrides?: Partial<Pick<Cronjob, 'name' | 'cronExpression'>>) => Promise<Cronjob>;
}

const test = base.extend<CronjobFixtures>({
  createCronjob: async ({ adminApi, createConnection }, use) => {
    const createdIds: string[] = [];

    await use(async (overrides = {}) => {
      const { connection } = await createConnection();
      const response = await adminApi.post('cronjobs', {
        data: {
          name: uniqueName('cron'),
          connectionId: connection.id,
          cronExpression: JANUARY_FIRST,
          frequency: 'custom',
          ...overrides,
        },
      });
      const cronjob = await expectSuccessEnvelope<Cronjob>(response, 201);
      createdIds.push(cronjob.id);
      return cronjob;
    });

    // A test may delete its cronjob itself, so a 404 here is fine.
    for (const id of createdIds.reverse()) {
      const response = await adminApi.delete(`cronjobs/${id}`);
      if (response.status() !== 404) {
        await assertOk(response, `Cleaning up cronjob ${id}`);
      }
    }
  },
});

function expectFutureDate(value: string | null): void {
  expect(value).not.toBeNull();
  expect(new Date(value as string).getTime()).toBeGreaterThan(Date.now());
}

test.describe('create', () => {
  test('creates an active cronjob and schedules its next run', async ({ createCronjob }) => {
    const name = uniqueName('cron');

    const cronjob = await createCronjob({ name });

    expect(cronjob).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name,
      cronExpression: JANUARY_FIRST,
      frequency: 'custom',
      isActive: true,
    });
    expectFutureDate(cronjob.nextRunAt);
  });
});

test.describe('update', () => {
  // Regression guard for D17: a rename answered with only the fields it sent,
  // so the API read the cronjob as inactive, removed it from the scheduler and
  // stored `nextRunAt: null` while the row still said `isActive: true`.
  test('keeps an active cronjob scheduled when it is renamed', async ({ request, createCronjob }) => {
    const cronjob = await createCronjob();
    const name = uniqueName('renamed');

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { name } }),
    );

    expect(updated).toMatchObject({
      id: cronjob.id,
      name,
      connectionId: cronjob.connectionId,
      cronExpression: JANUARY_FIRST,
      isActive: true,
      nextRunAt: cronjob.nextRunAt,
    });
    const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
    expect(reread).toMatchObject({ name, isActive: true, nextRunAt: cronjob.nextRunAt });
  });

  test('moves the next run when the expression changes', async ({ request, createCronjob }) => {
    const cronjob = await createCronjob();

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { cronExpression: JULY_FIRST } }),
    );

    expect(updated).toMatchObject({ cronExpression: JULY_FIRST, isActive: true, name: cronjob.name });
    expectFutureDate(updated.nextRunAt);
    expect(updated.nextRunAt).not.toBe(cronjob.nextRunAt);
    // 1 July and 1 January are about six months apart, whatever the API's time zone.
    const gapInDays =
      Math.abs(new Date(updated.nextRunAt as string).getTime() - new Date(cronjob.nextRunAt as string).getTime()) /
      86_400_000;
    expect(gapInDays).toBeGreaterThan(150);
    const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
    expect(reread).toMatchObject({ cronExpression: JULY_FIRST, isActive: true, nextRunAt: updated.nextRunAt });
  });

  test('keeps a paused cronjob paused when it is renamed', async ({ request, createCronjob }) => {
    const cronjob = await createCronjob();
    await assertOk(await request.post(`cronjobs/${cronjob.id}/toggle`), 'Pausing the cronjob');
    const name = uniqueName('renamed');

    const updated = await expectSuccessEnvelope<Cronjob>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { name } }),
    );

    expect(updated).toMatchObject({ name, isActive: false, nextRunAt: null });
    const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
    expect(reread).toMatchObject({ name, isActive: false, nextRunAt: null });
  });

  test('answers 404 for an unknown id', async ({ request }) => {
    await expectErrorEnvelope(
      await request.patch(`cronjobs/${UNKNOWN_ID}`, { data: { name: uniqueName('ghost') } }),
      404,
    );
  });
});

test.describe('toggle', () => {
  test('pauses and resumes a cronjob and answers with the whole cronjob', async ({ request, createCronjob }) => {
    const cronjob = await createCronjob();

    const paused = await expectSuccessEnvelope<Cronjob>(await request.post(`cronjobs/${cronjob.id}/toggle`), 201);
    expect(paused).toMatchObject({
      id: cronjob.id,
      name: cronjob.name,
      cronExpression: JANUARY_FIRST,
      isActive: false,
      nextRunAt: null,
    });

    const resumed = await expectSuccessEnvelope<Cronjob>(await request.post(`cronjobs/${cronjob.id}/toggle`), 201);
    expect(resumed).toMatchObject({ id: cronjob.id, name: cronjob.name, isActive: true });
    expectFutureDate(resumed.nextRunAt);
  });
});

// Regression guard for D18: the update DTO marked every field optional with
// `@IsOptional()`, which lets `null` skip validation as well, so a `null` for a
// required field reached the database and came back as a 500.
test.describe('update with null', () => {
  for (const field of ['name', 'cronExpression', 'frequency', 'connectionId', 'isActive', 'retentionEnabled']) {
    test(`rejects a null ${field} with 400 and keeps the cronjob`, async ({ request, createCronjob }) => {
      const cronjob = await createCronjob();

      await expectErrorEnvelope(
        await request.patch(`cronjobs/${cronjob.id}`, { data: { [field]: null } }),
        400,
      );

      const reread = await expectSuccessEnvelope<Cronjob>(await request.get(`cronjobs/${cronjob.id}`));
      expect(reread).toMatchObject({
        name: cronjob.name,
        cronExpression: cronjob.cronExpression,
        frequency: cronjob.frequency,
        connectionId: cronjob.connectionId,
        isActive: true,
        nextRunAt: cronjob.nextRunAt,
      });
    });
  }

  // The retention limits are nullable columns: null is how a limit is removed.
  test('clears a retention limit with null', async ({ request, createCronjob }) => {
    const cronjob = await createCronjob();
    await assertOk(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { retentionKeepLast: 3 } }),
      'Setting a retention limit',
    );

    const updated = await expectSuccessEnvelope<Cronjob & { retentionKeepLast: number | null }>(
      await request.patch(`cronjobs/${cronjob.id}`, { data: { retentionKeepLast: null } }),
    );

    expect(updated).toMatchObject({ retentionKeepLast: null, isActive: true });
    const reread = await expectSuccessEnvelope<{ retentionKeepLast: number | null }>(
      await request.get(`cronjobs/${cronjob.id}`),
    );
    expect(reread.retentionKeepLast).toBeNull();
  });
});
