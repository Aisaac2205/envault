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
