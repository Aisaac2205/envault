import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test } from '../../support/fixtures';

// Shapes of the read-only endpoints the dashboard builds on. Fields and types
// are the contract; durations and timestamps are volatile and never pinned.
//
// The "stack without jobs" groups also pin the counts to zero. That holds on a
// freshly started stack, because nothing in the suite creates a backup or a
// restore yet. Once specs start running backups they have to move to the
// invariants (totals add up, lists are arrays) or reset the stack first.

const COUNT = expect.any(Number);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `count` calendar days starting at `first` (YYYY-MM-DD), in UTC. */
function consecutiveDays(first: string, count: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  return Array.from({ length: count }, (_, offset) =>
    new Date(start + offset * 86_400_000).toISOString().slice(0, 10),
  );
}

test.describe('stack without jobs', () => {
  test('GET /jobs/summary counts every status as zero', async ({ request }) => {
    const summary = await expectSuccessEnvelope(await request.get('jobs/summary'));

    expect(summary).toEqual({ total: 0, completed: 0, failed: 0, pending: 0, running: 0 });
  });

  test('GET /jobs/stats reports zero rates, counts and storage', async ({ request }) => {
    const stats = await expectSuccessEnvelope(await request.get('jobs/stats'));

    expect(stats).toEqual({ successRate30d: 0, backupsToday: 0, failed7d: 0, totalStorageMb: 0 });
  });

  test('GET /jobs/daily-counts is an empty list', async ({ request }) => {
    expect(await expectSuccessEnvelope(await request.get('jobs/daily-counts'))).toEqual([]);
  });

  test('GET /jobs/analytics/storage-by-connection is an empty list', async ({ request }) => {
    const rows = await expectSuccessEnvelope(
      await request.get('jobs/analytics/storage-by-connection'),
    );

    expect(rows).toEqual([]);
  });

  test('GET /jobs/analytics/restore-status counts every status as zero', async ({ request }) => {
    const counts = await expectSuccessEnvelope(
      await request.get('jobs/analytics/restore-status'),
    );

    expect(counts).toEqual({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 });
  });

  for (const path of ['backups', 'restores', 'jobs/backups', 'jobs/restores']) {
    test(`GET /${path} is an empty list`, async ({ request }) => {
      expect(await expectSuccessEnvelope(await request.get(path))).toEqual([]);
    });
  }

  test('GET /backups/history is an empty page, double-wrapped', async ({ request }) => {
    const response = await request.get('backups/history');
    expect(response.status()).toBe(200);

    // The page is the `data` of the envelope, and it has its own `data` list.
    expect(await response.json()).toEqual({
      data: { data: [], total: 0, page: 1, pageSize: 25 },
      timestamp: expect.any(String),
    });
  });
});

test.describe('GET /jobs/analytics/daily', () => {
  for (const window of [7, 30, 90]) {
    test(`returns one zero-filled entry per day for window=${window}`, async ({ request }) => {
      const series = await expectSuccessEnvelope<{
        window: number;
        from: string;
        to: string;
        timezone: string;
        days: Record<string, unknown>[];
      }>(await request.get(`jobs/analytics/daily?window=${window}`));

      expect(series).toMatchObject({ window, timezone: 'UTC' });
      expect(series.from).toMatch(ISO_DAY);
      expect(series.days.map((day) => day.date)).toEqual(consecutiveDays(series.from, window));
      expect(series.to).toBe(series.days.at(-1)?.date);
      for (const day of series.days) {
        expect(day).toEqual({
          date: expect.stringMatching(ISO_DAY),
          completed: 0,
          failed: 0,
          p50DurationSeconds: null,
          p95DurationSeconds: null,
          totalSizeMb: 0,
        });
      }
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

    expect(page).toMatchObject({ data: [], page: 1, pageSize: 5 });
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
