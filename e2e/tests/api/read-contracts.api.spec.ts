import { randomUUID } from 'node:crypto';
import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test } from '../../support/fixtures';

// Shapes of the read-only endpoints the dashboard builds on. Fields and types
// are the contract; durations and timestamps are volatile and never pinned.
//
// The stack is shared and its job tables are never empty for long: the
// `pipeline` project runs real backups and restores, and no endpoint deletes a
// job row. Counts are therefore checked as invariants that hold whatever else
// ran (a total equals the sum of its parts, a count is a whole number that is
// not negative, a list is an array), never as values.

const COUNT = expect.any(Number);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `count` calendar days starting at `first` (YYYY-MM-DD), in UTC. */
function consecutiveDays(first: string, count: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, offset) =>
    new Date(start + offset * 86_400_000).toISOString().slice(0, 10),
  );
}

function expectCount(value: unknown): void {
  expect(Number.isInteger(value) && (value as number) >= 0, `${value} is a whole number >= 0`).toBe(true);
}

/** Every value is a count, and `total` is the sum of the parts. */
function expectCountsAddUp(counts: Record<string, number>, parts: string[]): void {
  Object.values(counts).forEach(expectCount);
  expect(counts.total).toBe(parts.reduce((sum, part) => sum + counts[part], 0));
}

test.describe('job counters', () => {
  test('GET /jobs/summary counts every status and the total adds them up', async ({ request }) => {
    const summary = await expectSuccessEnvelope<Record<string, number>>(await request.get('jobs/summary'));

    expect(summary).toEqual({ total: COUNT, completed: COUNT, failed: COUNT, pending: COUNT, running: COUNT });
    expectCountsAddUp(summary, ['completed', 'failed', 'pending', 'running']);
  });

  test('GET /jobs/stats reports a rate, counts and storage', async ({ request }) => {
    const stats = await expectSuccessEnvelope<Record<string, number>>(await request.get('jobs/stats'));

    expect(stats).toEqual({ successRate30d: COUNT, backupsToday: COUNT, failed7d: COUNT, totalStorageMb: COUNT });
    expect(stats.successRate30d).toBeGreaterThanOrEqual(0);
    expect(stats.successRate30d).toBeLessThanOrEqual(100);
    expectCount(stats.backupsToday);
    expectCount(stats.failed7d);
    expect(stats.totalStorageMb).toBeGreaterThanOrEqual(0);
  });

  test('GET /jobs/daily-counts lists days with a count per trigger', async ({ request }) => {
    const rows = await expectSuccessEnvelope<Record<string, unknown>[]>(await request.get('jobs/daily-counts'));

    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row).toEqual({ date: expect.stringMatching(ISO_DAY), scheduled: COUNT, manual: COUNT });
      expectCount(row.scheduled);
      expectCount(row.manual);
    }
    // One row per day, oldest first.
    const days = rows.map((row) => row.date as string);
    expect(days).toEqual([...new Set(days)].sort());
  });

  test('GET /jobs/analytics/storage-by-connection lists a size per connection', async ({ request }) => {
    const rows = await expectSuccessEnvelope<Record<string, unknown>[]>(
      await request.get('jobs/analytics/storage-by-connection'),
    );

    expect(Array.isArray(rows)).toBe(true);
    for (const { connectionName, ...row } of rows) {
      expect(row).toEqual({ connectionId: expect.any(String), totalSizeMb: COUNT, backupCount: COUNT });
      // The name is null for a connection that has since been deleted.
      expect(connectionName === null || typeof connectionName === 'string').toBe(true);
      expect(row.totalSizeMb as number).toBeGreaterThanOrEqual(0);
      // A connection only appears here because it has a completed backup.
      expect(row.backupCount as number).toBeGreaterThanOrEqual(1);
    }
  });

  test('GET /jobs/analytics/restore-status counts every status and the total adds them up', async ({ request }) => {
    const counts = await expectSuccessEnvelope<Record<string, number>>(
      await request.get('jobs/analytics/restore-status'),
    );

    expect(counts).toEqual({ pending: COUNT, running: COUNT, completed: COUNT, failed: COUNT, total: COUNT });
    expectCountsAddUp(counts, ['pending', 'running', 'completed', 'failed']);
  });

  for (const path of ['backups', 'restores', 'jobs/backups', 'jobs/restores']) {
    test(`GET /${path} is a list`, async ({ request }) => {
      expect(Array.isArray(await expectSuccessEnvelope(await request.get(path)))).toBe(true);
    });
  }

  test('GET /backups/history is a page, double-wrapped', async ({ request }) => {
    const response = await request.get('backups/history');
    expect(response.status()).toBe(200);

    // The page is the `data` of the envelope, and it has its own `data` list.
    const { data: page, timestamp } = await response.json();
    expect(timestamp).toEqual(expect.any(String));
    expect(page).toEqual({ data: expect.any(Array), total: COUNT, page: 1, pageSize: 25 });
    expect(page.data.length).toBeLessThanOrEqual(page.pageSize);
    expect(page.total).toBeGreaterThanOrEqual(page.data.length);
  });
});

test.describe('GET /jobs/analytics/daily', () => {
  for (const window of [7, 30, 90]) {
    test(`returns one entry per day for window=${window}`, async ({ request }) => {
      const series = await expectSuccessEnvelope<{
        window: number;
        from: string;
        to: string;
        timezone: string;
        connectionId: string | null;
        days: Record<string, number | string | null>[];
      }>(await request.get(`jobs/analytics/daily?window=${window}`));

      expect(series).toMatchObject({ window, timezone: 'UTC', connectionId: null });
      expect(series.from).toMatch(ISO_DAY);
      expect(series.days.map((day) => day.date)).toEqual(consecutiveDays(series.from, window));
      expect(series.to).toBe(series.days.at(-1)?.date);
      for (const day of series.days) {
        expect(Object.keys(day).sort()).toEqual([
          'completed',
          'date',
          'failed',
          'maxDurationSeconds',
          'p50DurationSeconds',
          'p95DurationSeconds',
          'totalSizeMb',
        ]);
        expect(day.date).toMatch(ISO_DAY);
        expectCount(day.completed);
        expectCount(day.failed);
        expect(day.totalSizeMb as number).toBeGreaterThanOrEqual(0);

        // Durations are those of the day's completed backups: none, no duration
        // (null); otherwise numbers ordered median <= 95th percentile <= max.
        if (day.completed === 0) {
          expect(day.p50DurationSeconds).toBeNull();
          expect(day.p95DurationSeconds).toBeNull();
          expect(day.maxDurationSeconds).toBeNull();
        } else {
          expect(day.p50DurationSeconds as number).toBeGreaterThanOrEqual(0);
          expect(day.p95DurationSeconds as number).toBeGreaterThanOrEqual(day.p50DurationSeconds as number);
          expect(day.maxDurationSeconds as number).toBeGreaterThanOrEqual(day.p95DurationSeconds as number);
        }
      }
    });
  }

  test('scopes the series to a connectionId and echoes it', async ({ request }) => {
    // A random id that no backup belongs to: every day is empty, whatever else ran.
    const connectionId = randomUUID();
    const series = await expectSuccessEnvelope<{
      connectionId: string | null;
      days: { completed: number; failed: number; totalSizeMb: number }[];
    }>(await request.get(`jobs/analytics/daily?window=7&connectionId=${connectionId}`));

    expect(series.connectionId).toBe(connectionId);
    expect(series.days).toHaveLength(7);
    for (const day of series.days) {
      expect(day).toMatchObject({ completed: 0, failed: 0, totalSizeMb: 0 });
    }
  });

  for (const connectionId of ['not-a-uuid', '123']) {
    test(`rejects connectionId=${connectionId} with 400`, async ({ request }) => {
      await expectErrorEnvelope(await request.get(`jobs/analytics/daily?connectionId=${connectionId}`), 400);
    });
  }

  test('defaults to a 30-day window', async ({ request }) => {
    const series = await expectSuccessEnvelope<{ window: number; days: unknown[] }>(
      await request.get('jobs/analytics/daily'),
    );

    expect(series.window).toBe(30);
    expect(series.days).toHaveLength(30);
  });

  for (const window of ['0', '8', '-7', '7.5', 'abc']) {
    test(`rejects window=${window} with 400`, async ({ request }) => {
      await expectErrorEnvelope(await request.get(`jobs/analytics/daily?window=${window}`), 400);
    });
  }
});

interface WindowStats {
  completed: number;
  failed: number;
  successRate: number | null;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
}

interface ConnectionHealth extends WindowStats {
  connectionId: string;
  connectionName: string;
  environment: string;
  dbType: string;
  lastBackup: Record<string, unknown> | null;
  lastSuccessAt: string | null;
  schedules: Record<string, unknown>[];
  freshness: string;
}

interface ConnectionsHealth {
  window: number;
  from: string;
  to: string;
  timezone: string;
  overall: WindowStats;
  connections: ConnectionHealth[];
}

const WINDOW_STATS_KEYS = ['completed', 'failed', 'p50DurationSeconds', 'p95DurationSeconds', 'successRate'];

function expectIsoDateTime(value: unknown): void {
  expect(typeof value === 'string' && !Number.isNaN(Date.parse(value)), `${value} is a date-time`).toBe(true);
}

/** Counts, the success rate derived from them, and the ordered percentiles of one scope. */
function expectWindowStats(stats: WindowStats): void {
  expectCount(stats.completed);
  expectCount(stats.failed);

  const finished = stats.completed + stats.failed;
  if (finished === 0) {
    expect(stats.successRate).toBeNull();
  } else {
    expect(stats.successRate as number).toBeGreaterThanOrEqual(0);
    expect(stats.successRate as number).toBeLessThanOrEqual(1);
    // Rounded to four decimals.
    expect(Math.abs((stats.successRate as number) - stats.completed / finished)).toBeLessThanOrEqual(0.00005 + 1e-9);
  }

  // Durations come from completed backups only, and both percentiles come from the same set.
  expect(stats.p50DurationSeconds === null).toBe(stats.p95DurationSeconds === null);
  if (stats.completed === 0) {
    expect(stats.p50DurationSeconds).toBeNull();
  }
  if (stats.p50DurationSeconds !== null && stats.p95DurationSeconds !== null) {
    expect(stats.p50DurationSeconds).toBeGreaterThanOrEqual(0);
    expect(stats.p95DurationSeconds).toBeGreaterThanOrEqual(stats.p50DurationSeconds);
  }
}

test.describe('GET /jobs/analytics/connections-health', () => {
  const NAME_ORDER = new Intl.Collator('en', { sensitivity: 'base' });

  for (const window of [7, 30, 90]) {
    test(`returns the overall figures and one entry per active production connection for window=${window}`, async ({
      request,
    }) => {
      const health = await expectSuccessEnvelope<ConnectionsHealth>(
        await request.get(`jobs/analytics/connections-health?window=${window}`),
      );

      expect(Object.keys(health).sort()).toEqual(['connections', 'from', 'overall', 'timezone', 'to', 'window']);
      expect(health).toMatchObject({ window, timezone: 'UTC' });
      expect(health.from).toMatch(ISO_DAY);
      expect(health.to).toBe(consecutiveDays(health.from, window).at(-1));

      expect(Object.keys(health.overall).sort()).toEqual(WINDOW_STATS_KEYS);
      expectWindowStats(health.overall);

      expect(Array.isArray(health.connections)).toBe(true);
      const names = health.connections.map((connection) => connection.connectionName);
      expect(names.every((name, index) => index === 0 || NAME_ORDER.compare(names[index - 1], name) <= 0)).toBe(true);
      expect(new Set(health.connections.map((connection) => connection.connectionId)).size).toBe(names.length);

      // The overall figures cover every connection, listed or not.
      const sum = (key: 'completed' | 'failed') => health.connections.reduce((total, c) => total + c[key], 0);
      expect(health.overall.completed).toBeGreaterThanOrEqual(sum('completed'));
      expect(health.overall.failed).toBeGreaterThanOrEqual(sum('failed'));

      for (const connection of health.connections) {
        expect(Object.keys(connection).sort()).toEqual(
          [
            'connectionId',
            'connectionName',
            'dbType',
            'environment',
            'freshness',
            'lastBackup',
            'lastSuccessAt',
            'schedules',
            ...WINDOW_STATS_KEYS,
          ].sort(),
        );
        expect(connection.connectionId).toEqual(expect.any(String));
        expect(connection.connectionName).toEqual(expect.any(String));
        expect(connection.environment).toBe('prod');
        expect(['postgres', 'mysql']).toContain(connection.dbType);
        expectWindowStats(connection);
      }
    });

    test(`describes the last backup, the schedules and the freshness of each connection for window=${window}`, async ({
      request,
    }) => {
      const { connections } = await expectSuccessEnvelope<ConnectionsHealth>(
        await request.get(`jobs/analytics/connections-health?window=${window}`),
      );

      for (const connection of connections) {
        // The last backup is the latest completed or failed one, of any age; pending and running ones are not outcomes.
        if (connection.lastBackup !== null) {
          expect(Object.keys(connection.lastBackup).sort()).toEqual([
            'completedAt',
            'createdAt',
            'durationSeconds',
            'fileSizeMb',
            'status',
          ]);
          expect(['completed', 'failed']).toContain(connection.lastBackup.status);
          expectIsoDateTime(connection.lastBackup.createdAt);
          for (const key of ['completedAt', 'durationSeconds', 'fileSizeMb']) {
            const value = connection.lastBackup[key];
            expect(value === null || (key === 'completedAt' ? typeof value === 'string' : (value as number) >= 0)).toBe(true);
          }
        }
        if (connection.lastSuccessAt !== null) expectIsoDateTime(connection.lastSuccessAt);

        for (const schedule of connection.schedules) {
          expect(Object.keys(schedule).sort()).toEqual(['cronjobId', 'intervalSeconds', 'lastRunAt', 'lastStatus', 'nextRunAt']);
          expect(schedule.cronjobId).toEqual(expect.any(String));
          for (const key of ['nextRunAt', 'lastRunAt']) {
            if (schedule[key] !== null) expectIsoDateTime(schedule[key]);
          }
          expect(schedule.lastStatus === null || typeof schedule.lastStatus === 'string').toBe(true);
          expect(schedule.intervalSeconds === null || (schedule.intervalSeconds as number) > 0).toBe(true);
        }

        expect(['ok', 'late', 'stale', 'unknown']).toContain(connection.freshness);
        // Freshness needs an interval to compare with; with one, a connection that never succeeded is stale.
        const hasInterval = connection.schedules.some((schedule) => schedule.intervalSeconds !== null);
        if (!hasInterval) expect(connection.freshness).toBe('unknown');
        else if (connection.lastSuccessAt === null) expect(connection.freshness).toBe('stale');
      }
    });
  }

  test('defaults to a 30-day window', async ({ request }) => {
    const health = await expectSuccessEnvelope<ConnectionsHealth>(await request.get('jobs/analytics/connections-health'));

    expect(health.window).toBe(30);
    expect(health.to).toBe(consecutiveDays(health.from, 30).at(-1));
  });

  for (const window of ['0', '8', '-7', '7.5', 'abc']) {
    test(`rejects window=${window} with 400`, async ({ request }) => {
      await expectErrorEnvelope(await request.get(`jobs/analytics/connections-health?window=${window}`), 400);
    });
  }

  test('rejects a connectionId, which this endpoint does not take, with 400', async ({ request }) => {
    await expectErrorEnvelope(
      await request.get(`jobs/analytics/connections-health?window=7&connectionId=${randomUUID()}`),
      400,
    );
  });
});

test.describe('pagination of GET /backups/history', () => {
  test('echoes the requested page size', async ({ request }) => {
    const page = await expectSuccessEnvelope<{ data: unknown[]; pageSize: number; page: number }>(
      await request.get('backups/history?page=1&pageSize=5'),
    );

    expect(page).toMatchObject({ page: 1, pageSize: 5 });
    expect(page.data.length).toBeLessThanOrEqual(5);
  });

  for (const query of ['page=0', 'pageSize=0', 'pageSize=101', 'status=unknown', 'environment=staging']) {
    test(`rejects ${query} with 400`, async ({ request }) => {
      await expectErrorEnvelope(await request.get(`backups/history?${query}`), 400);
    });
  }
});

// The audit log is never empty: every sign-in is recorded, including the one
// the suite made. Only its shape is stable.
test.describe('GET /audit', () => {
  test('returns a page of entries, double-wrapped', async ({ request }) => {
    const response = await request.get('audit?pageSize=5');
    expect(response.status()).toBe(200);

    const { data: page, timestamp } = await response.json();
    expect(timestamp).toEqual(expect.any(String));
    expect(page).toEqual({
      data: expect.any(Array),
      total: COUNT,
      page: 1,
      pageSize: 5,
    });
    expect(page.data.length).toBeLessThanOrEqual(5);
    expect(page.total).toBeGreaterThanOrEqual(page.data.length);
    for (const entry of page.data) {
      expect(entry).toMatchObject({
        id: expect.any(String),
        action: expect.any(String),
        outcome: expect.any(String),
        createdAt: expect.any(String),
      });
    }
  });

  for (const query of ['page=0', 'pageSize=101', 'environment=staging', 'from=not-a-date']) {
    test(`rejects ${query} with 400`, async ({ request }) => {
      await expectErrorEnvelope(await request.get(`audit?${query}`), 400);
    });
  }
});
