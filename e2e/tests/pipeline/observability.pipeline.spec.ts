import { expectSuccessEnvelope } from '../../support/envelope';
import type { BackupJob, RestoreJob } from '../../support/jobs';
import { expect, test } from '../../support/pipeline-fixtures';

// The dashboard, the dumps page and the restore page are built on the job
// endpoints. This checks that a backup and a restore that really ran show up in
// every one of them. The stack is shared and there is no endpoint that deletes
// job rows, so other runs have always left jobs behind: the assertions look for
// this test's own jobs, or state invariants that hold whatever else exists.

interface DailyPoint {
  date: string;
  completed: number;
  failed: number;
  p50DurationSeconds: number | null;
  p95DurationSeconds: number | null;
  totalSizeMb: number;
}

test('shows a completed backup and restore in the job lists, history and analytics', async ({
  backedUp,
  restoreTarget,
  jobs,
  adminApi,
}) => {
  const { backup, connection } = await backedUp('mysql');
  const { connection: target } = await restoreTarget('mysql', 'dev');
  const restore = await jobs.restore({ sourceBackupId: backup.id, targetConnectionId: target.id });

  const get = async <T>(path: string): Promise<T> => expectSuccessEnvelope<T>(await adminApi.get(path));
  const ids = (list: { id: string }[]): string[] => list.map(({ id }) => id);

  await test.step('job lists', async () => {
    expect(ids(await get<BackupJob[]>('jobs/backups'))).toContain(backup.id);
    expect(ids(await get<BackupJob[]>('jobs/backups?status=completed'))).toContain(backup.id);
    expect(ids(await get<BackupJob[]>('jobs/backups?status=failed'))).not.toContain(backup.id);
    expect(ids(await get<BackupJob[]>('jobs/backups?environment=prod'))).toContain(backup.id);
    expect(ids(await get<BackupJob[]>('jobs/backups?environment=dev'))).not.toContain(backup.id);
    expect(await get<BackupJob[]>('jobs/backups')).toContainEqual(
      expect.objectContaining({ id: backup.id, connectionName: connection.name }),
    );

    expect(ids(await get<RestoreJob[]>('jobs/restores'))).toContain(restore.id);
    expect(ids(await get<RestoreJob[]>('jobs/restores?status=completed'))).toContain(restore.id);
    expect(ids(await get<RestoreJob[]>('jobs/restores?environment=dev'))).toContain(restore.id);
    expect(ids(await get<RestoreJob[]>('jobs/restores?environment=prod'))).not.toContain(restore.id);

    expect(ids(await get<BackupJob[]>('backups'))).toContain(backup.id);
    expect(ids(await get<RestoreJob[]>('restores'))).toContain(restore.id);
  });

  await test.step('single jobs', async () => {
    // The same row through both routes; only the backup route adds the connection's name.
    const { connectionName, ...row } = backup;
    expect(connectionName).toBe(connection.name);
    expect(await get(`jobs/backups/${backup.id}`)).toEqual(row);
    expect(await get(`jobs/restores/${restore.id}`)).toEqual(restore);
  });

  await test.step('history', async () => {
    const history = await get<{ data: BackupJob[]; total: number; page: number; pageSize: number }>(
      `backups/history?connectionId=${connection.id}`,
    );
    expect(history).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(history.data).toEqual([backup]);

    const failures = await get<{ total: number }>(`backups/history?connectionId=${connection.id}&status=failed`);
    expect(failures.total).toBe(0);
  });

  await test.step('daily analytics', async () => {
    const day = backup.createdAt.slice(0, 10);
    const series = await get<{ window: number; days: DailyPoint[] }>('jobs/analytics/daily?window=7');
    expect(series.window).toBe(7);

    // Other tests run backups on the same day, so the day holds at least this one.
    const point = series.days.find(({ date }) => date === day);
    expect(point, `a point for ${day}`).toBeDefined();
    expect(point!.completed).toBeGreaterThanOrEqual(1);
    expect(point!.failed).toBeGreaterThanOrEqual(0);
    expect(point!.totalSizeMb).toBeGreaterThanOrEqual(backup.fileSizeMb!);
    expect(point!.p50DurationSeconds).toBeGreaterThanOrEqual(0);
    expect(point!.p95DurationSeconds).toBeGreaterThanOrEqual(point!.p50DurationSeconds!);
  });

  await test.step('totals', async () => {
    const summary = await get<Record<string, number>>('jobs/summary');
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(summary.total).toBe(summary.completed + summary.failed + summary.pending + summary.running);

    const counts = await get<Record<string, number>>('jobs/analytics/restore-status');
    expect(counts.completed).toBeGreaterThanOrEqual(1);
    expect(counts.total).toBe(counts.completed + counts.failed + counts.pending + counts.running);

    const storage = await get<{ connectionId: string; backupCount: number; totalSizeMb: number }[]>(
      'jobs/analytics/storage-by-connection',
    );
    // Grouped by connection, and this connection ran exactly one backup.
    const row = storage.find(({ connectionId }) => connectionId === connection.id);
    expect(row).toMatchObject({ backupCount: 1 });
    expect(row!.totalSizeMb).toBeCloseTo(backup.fileSizeMb!, 9);

    const dailyCounts = await get<{ date: string; scheduled: number; manual: number }[]>('jobs/daily-counts');
    expect(dailyCounts.find(({ date }) => date === backup.createdAt.slice(0, 10))!.manual).toBeGreaterThanOrEqual(1);
  });
});
