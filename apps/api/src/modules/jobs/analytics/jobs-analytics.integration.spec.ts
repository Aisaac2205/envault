import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { BackupDailyRollupEntity } from '../../../database/entities/backup-daily-rollup.entity';
import { BackupJobEntity } from '../../../database/entities/backup-job.entity';
import { RestoreJobEntity } from '../../../database/entities/restore-job.entity';
import { Environment } from '../../../database/enums/environment.enum';
import { JobStatus } from '../../../database/enums/job-status.enum';
import { JobsAnalyticsRepository } from './jobs-analytics.repository';

function resolveAdminDatabaseUrl(): string | null {
  const value = process.env.JOBS_ANALYTICS_TEST_DATABASE_URL;
  if (!value) return null;

  const url = new URL(value);
  const isTestServer =
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname === 'localhost' &&
    url.port === '5434' &&
    url.pathname === '/testdb' &&
    url.username === 'test_user';

  if (!isTestServer) {
    throw new Error('JOBS_ANALYTICS_TEST_DATABASE_URL must target the local test database');
  }

  return value;
}

/** Builds a connection URL to another database on the same Postgres server. */
function withDatabaseName(adminUrl: string, databaseName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

const adminDatabaseUrl = resolveAdminDatabaseUrl();
const integration = adminDatabaseUrl ? describe : describe.skip;

integration('jobs analytics PostgreSQL integration', () => {
  // A uniquely-named throwaway database per run, built from the real
  // migration chain (never hand-written DDL) so this suite validates the raw
  // SQL in JobsAnalyticsRepository against the exact column types production
  // has (enum-typed status, TIMESTAMP-without-tz columns, etc).
  const databaseName = `jobs_analytics_it_${process.pid}_${Date.now()}`;

  let adminDataSource: DataSource;
  let dataSource: DataSource;
  let repository: JobsAnalyticsRepository;

  beforeAll(async () => {
    const url = adminDatabaseUrl ?? '';
    adminDataSource = new DataSource({ type: 'postgres', url });
    await adminDataSource.initialize();
    await adminDataSource.query(`CREATE DATABASE "${databaseName}"`);

    const testDatabaseUrl = withDatabaseName(url, databaseName);

    const migrationsDataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      migrations: [join(__dirname, '../../../database/migrations/*{.ts,.js}')],
    });
    await migrationsDataSource.initialize();
    await migrationsDataSource.runMigrations();
    await migrationsDataSource.destroy();

    // A single pooled connection so the session TimeZone test below is
    // guaranteed to run its follow-up query against the same session.
    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      entities: [BackupJobEntity, BackupDailyRollupEntity, RestoreJobEntity],
      extra: { max: 1 },
    });
    await dataSource.initialize();

    repository = new JobsAnalyticsRepository(
      dataSource.getRepository(BackupJobEntity),
      dataSource.getRepository(RestoreJobEntity),
    );
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } finally {
      if (adminDataSource?.isInitialized) {
        await adminDataSource.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await adminDataSource.destroy();
      }
    }
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM backup_jobs');
    await dataSource.query('DELETE FROM backup_daily_rollups');
    await dataSource.query('DELETE FROM restore_jobs');
    await dataSource.query(`SET TIME ZONE 'UTC'`);
  });

  async function insertBackupJob(row: {
    id: string;
    connectionId: string;
    status: JobStatus;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    fileSizeMb?: number | null;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO backup_jobs
         (id, "connectionId", environment, status, "fileKey", "triggeredBy", "fileSizeMb", "startedAt", "completedAt", "createdAt")
       VALUES ($1, $2, $3, $4, 'analytics-test.dump', 'analytics-test', $5, $6, $7, $8::timestamp)`,
      [
        row.id,
        row.connectionId,
        Environment.PROD,
        row.status,
        row.fileSizeMb ?? null,
        row.startedAt ? `${row.startedAt}` : null,
        row.completedAt ? `${row.completedAt}` : null,
        row.createdAt,
      ],
    );
  }

  async function insertRollup(row: {
    connectionId: string;
    day: string;
    completed: number;
    failed: number;
    totalSizeMb: number;
    durationsSeconds: number[];
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO backup_daily_rollups
         ("connectionId", "day", completed, failed, "totalSizeMb", "durationsSeconds")
       VALUES ($1, $2::date, $3, $4, $5, $6::float8[])`,
      [row.connectionId, row.day, row.completed, row.failed, row.totalSizeMb, row.durationsSeconds],
    );
  }

  async function insertRestoreJob(id: string, status: JobStatus): Promise<void> {
    await dataSource.query(
      `INSERT INTO restore_jobs
         (id, "targetConnectionId", "targetEnvironment", status, "startedAt", "triggeredBy")
       VALUES ($1, '00000000-0000-0000-0000-000000000601', $2, $3, now(), 'analytics-test')`,
      [id, Environment.PROD, status],
    );
  }

  describe('getDailyBackupRows', () => {
    const connectionId = '00000000-0000-0000-0000-000000000701';

    beforeEach(async () => {
      // Four completed jobs on 2026-03-10 with durations 10/20/30/40s.
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000801',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:00:00',
        startedAt: '2026-03-10 08:00:00',
        completedAt: '2026-03-10 08:00:10',
        fileSizeMb: 10,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000802',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:05:00',
        startedAt: '2026-03-10 08:05:00',
        completedAt: '2026-03-10 08:05:20',
        fileSizeMb: 20,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000803',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:10:00',
        startedAt: '2026-03-10 08:10:00',
        completedAt: '2026-03-10 08:10:30',
        fileSizeMb: 30,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000804',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:15:00',
        startedAt: '2026-03-10 08:15:00',
        completedAt: '2026-03-10 08:15:40',
        fileSizeMb: 40,
      });
      // A failed job the same day: counts toward `failed`, excluded from percentiles/size.
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000805',
        connectionId,
        status: JobStatus.FAILED,
        createdAt: '2026-03-10 09:00:00',
        startedAt: '2026-03-10 09:00:00',
        completedAt: '2026-03-10 09:00:05',
        fileSizeMb: 999,
      });
      // A completed job with no startedAt/completedAt: counts toward `completed`
      // and totalSizeMb, but is excluded from the percentile calculation.
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000806',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 10:00:00',
        fileSizeMb: 5,
      });
      // Edge rows just outside [from, toExclusive) — must not affect the day.
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000807',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-09 23:59:59',
        fileSizeMb: 999,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000808',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-11 00:00:00',
        fileSizeMb: 999,
      });
    });

    it('aggregates counts, percentiles and size for the requested day and excludes rows outside the range', async () => {
      const rows = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

      expect(rows).toHaveLength(1);
      const [row] = rows;

      expect(row.date).toBe('2026-03-10');
      expect(Number(row.completed)).toBe(5);
      expect(Number(row.failed)).toBe(1);
      expect(row.p50).toBe(25);
      expect(row.p95).toBe(38.5);
      expect(row.max).toBe(40);
      expect(row.totalSizeMb).toBe(105);
    });

    it('returns node-pg shapes matching the raw row contract (bigint counts as strings, floats as numbers)', async () => {
      const [row] = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

      expect(typeof row.completed).toBe('string');
      expect(typeof row.failed).toBe('string');
      expect(typeof row.p50).toBe('number');
      expect(typeof row.p95).toBe('number');
      expect(typeof row.max).toBe('number');
      expect(typeof row.totalSizeMb).toBe('number');
    });

    it('produces the same result regardless of the session TimeZone (columns are timestamp without tz)', async () => {
      const utcResult = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

      await dataSource.query(`SET TIME ZONE 'America/Guatemala'`);
      const guatemalaResult = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });
      await dataSource.query(`SET TIME ZONE 'UTC'`);

      expect(guatemalaResult).toEqual(utcResult);
    });

    it('excludes pending and running jobs from completed/failed counts, percentiles, and totalSizeMb', async () => {
      // Both rows have full timestamp data and outlier durations/sizes so that,
      // if they leaked into the wrong bucket, the assertions below would fail.
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000b30',
        connectionId,
        status: JobStatus.PENDING,
        createdAt: '2026-03-10 11:00:00',
        startedAt: '2026-03-10 11:00:00',
        completedAt: '2026-03-10 11:16:40',
        fileSizeMb: 5000,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000b31',
        connectionId,
        status: JobStatus.RUNNING,
        createdAt: '2026-03-10 12:00:00',
        startedAt: '2026-03-10 12:00:00',
        completedAt: '2026-03-10 12:33:20',
        fileSizeMb: 6000,
      });

      const rows = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

      expect(rows).toHaveLength(1);
      const [row] = rows;
      // Same values as the base fixture (5 completed, 1 failed, p50=25, p95=38.5,
      // max=40, totalSizeMb=105): unchanged even with the pending/running rows present.
      expect(Number(row.completed)).toBe(5);
      expect(Number(row.failed)).toBe(1);
      expect(row.p50).toBe(25);
      expect(row.p95).toBe(38.5);
      expect(row.max).toBe(40);
      expect(row.totalSizeMb).toBe(105);
    });

    it('returns null durations and zero totalSizeMb for a day with only failed jobs (no completed)', async () => {
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000b10',
        connectionId,
        status: JobStatus.FAILED,
        createdAt: '2026-03-12 08:00:00',
        startedAt: '2026-03-12 08:00:00',
        completedAt: '2026-03-12 08:05:00',
        fileSizeMb: 999,
      });

      const rows = await repository.getDailyBackupRows({ from: '2026-03-12', toExclusive: '2026-03-13' });

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(Number(row.completed)).toBe(0);
      expect(Number(row.failed)).toBe(1);
      expect(row.p50).toBeNull();
      expect(row.p95).toBeNull();
      expect(row.max).toBeNull();
      expect(row.totalSizeMb).toBe(0);
    });

    it('excludes a completed job with null startedAt from the duration calculations', async () => {
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000b20',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-13 08:00:00',
        startedAt: '2026-03-13 08:00:00',
        completedAt: '2026-03-13 08:00:20',
        fileSizeMb: 20,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000b21',
        connectionId,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-13 09:00:00',
        // No startedAt/completedAt: must count toward `completed` and
        // `totalSizeMb`, but be excluded from the percentile and max calculations.
        fileSizeMb: 30,
      });

      const rows = await repository.getDailyBackupRows({ from: '2026-03-13', toExclusive: '2026-03-14' });

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(Number(row.completed)).toBe(2);
      expect(row.p50).toBe(20);
      expect(row.p95).toBe(20);
      expect(row.max).toBe(20);
      expect(row.totalSizeMb).toBe(50);
    });

    describe('rollup of purged jobs', () => {
      // 2026-03-19..21 are untouched by the fixture of the enclosing describe.
      const otherConnectionId = '00000000-0000-0000-0000-000000000702';

      it('merges the rollup counts, size and durations with the live rows of the same day', async () => {
        // Purged on 2026-03-20: two completed jobs (10s, 20s, 30 MB) and one failed job.
        await insertRollup({ connectionId, day: '2026-03-20', completed: 2, failed: 1, totalSizeMb: 30, durationsSeconds: [10, 20] });
        // Still live the same day: one completed job of 40s and 5 MB.
        await insertBackupJob({
          id: '00000000-0000-0000-0000-000000000d01',
          connectionId,
          status: JobStatus.COMPLETED,
          createdAt: '2026-03-20 08:00:00',
          startedAt: '2026-03-20 08:00:00',
          completedAt: '2026-03-20 08:00:40',
          fileSizeMb: 5,
        });

        const rows = await repository.getDailyBackupRows({ from: '2026-03-20', toExclusive: '2026-03-21' });

        expect(rows).toHaveLength(1);
        const [row] = rows;
        expect(Number(row.completed)).toBe(3);
        expect(Number(row.failed)).toBe(1);
        // Percentiles over the merged durations 10, 20 and 40.
        expect(row.p50).toBe(20);
        expect(row.p95).toBe(38);
        expect(row.max).toBe(40);
        expect(row.totalSizeMb).toBe(35);
      });

      it('returns a day that exists only in the rollup, and excludes rollup days outside the range', async () => {
        await insertRollup({ connectionId, day: '2026-03-19', completed: 9, failed: 9, totalSizeMb: 999, durationsSeconds: [999] });
        await insertRollup({ connectionId, day: '2026-03-20', completed: 1, failed: 2, totalSizeMb: 12.5, durationsSeconds: [7.5] });
        await insertRollup({ connectionId, day: '2026-03-21', completed: 9, failed: 9, totalSizeMb: 999, durationsSeconds: [999] });

        const rows = await repository.getDailyBackupRows({ from: '2026-03-20', toExclusive: '2026-03-21' });

        expect(rows).toEqual([
          { date: '2026-03-20', completed: '1', failed: '2', p50: 7.5, p95: 7.5, max: 7.5, totalSizeMb: 12.5 },
        ]);
      });

      it('keeps null durations for a rollup day without purged durations', async () => {
        await insertRollup({ connectionId, day: '2026-03-20', completed: 0, failed: 3, totalSizeMb: 0, durationsSeconds: [] });

        const rows = await repository.getDailyBackupRows({ from: '2026-03-20', toExclusive: '2026-03-21' });

        expect(rows).toEqual([
          { date: '2026-03-20', completed: '0', failed: '3', p50: null, p95: null, max: null, totalSizeMb: 0 },
        ]);
      });

      it('applies the connectionId filter to the rollup rows and their durations', async () => {
        await insertRollup({ connectionId, day: '2026-03-20', completed: 1, failed: 0, totalSizeMb: 4, durationsSeconds: [10] });
        await insertRollup({ connectionId: otherConnectionId, day: '2026-03-20', completed: 2, failed: 5, totalSizeMb: 100, durationsSeconds: [200, 300] });

        const [all] = await repository.getDailyBackupRows({ from: '2026-03-20', toExclusive: '2026-03-21' });
        const [scoped] = await repository.getDailyBackupRows({ from: '2026-03-20', toExclusive: '2026-03-21', connectionId });
        const none = await repository.getDailyBackupRows({
          from: '2026-03-20',
          toExclusive: '2026-03-21',
          connectionId: '00000000-0000-0000-0000-000000000799',
        });

        expect(Number(all.completed)).toBe(3);
        expect(Number(all.failed)).toBe(5);
        expect(all.max).toBe(300);
        expect(all.totalSizeMb).toBe(104);
        expect(Number(scoped.completed)).toBe(1);
        expect(Number(scoped.failed)).toBe(0);
        expect(scoped.p50).toBe(10);
        expect(scoped.max).toBe(10);
        expect(scoped.totalSizeMb).toBe(4);
        expect(none).toEqual([]);
      });
    });

    describe('connectionId filter', () => {
      const otherConnectionId = '00000000-0000-0000-0000-000000000702';

      beforeEach(async () => {
        // A second connection on the same day: one completed 100s/7MB backup and
        // one failed backup, so any leak would change every aggregate below.
        await insertBackupJob({
          id: '00000000-0000-0000-0000-000000000c01',
          connectionId: otherConnectionId,
          status: JobStatus.COMPLETED,
          createdAt: '2026-03-10 13:00:00',
          startedAt: '2026-03-10 13:00:00',
          completedAt: '2026-03-10 13:01:40',
          fileSizeMb: 7,
        });
        await insertBackupJob({
          id: '00000000-0000-0000-0000-000000000c02',
          connectionId: otherConnectionId,
          status: JobStatus.FAILED,
          createdAt: '2026-03-10 14:00:00',
          fileSizeMb: 999,
        });
      });

      it('aggregates every connection when no connectionId is given', async () => {
        const [row] = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

        expect(Number(row.completed)).toBe(6);
        expect(Number(row.failed)).toBe(2);
        expect(row.max).toBe(100);
        expect(row.totalSizeMb).toBe(112);
      });

      it('aggregates only the given connection', async () => {
        const rows = await repository.getDailyBackupRows({
          from: '2026-03-10',
          toExclusive: '2026-03-11',
          connectionId,
        });

        expect(rows).toHaveLength(1);
        const [row] = rows;
        // Exactly the base fixture: the other connection's jobs are excluded.
        expect(Number(row.completed)).toBe(5);
        expect(Number(row.failed)).toBe(1);
        expect(row.p50).toBe(25);
        expect(row.p95).toBe(38.5);
        expect(row.max).toBe(40);
        expect(row.totalSizeMb).toBe(105);
      });

      it('aggregates only the other connection when it is the one given', async () => {
        const [row] = await repository.getDailyBackupRows({
          from: '2026-03-10',
          toExclusive: '2026-03-11',
          connectionId: otherConnectionId,
        });

        expect(Number(row.completed)).toBe(1);
        expect(Number(row.failed)).toBe(1);
        expect(row.p50).toBe(100);
        expect(row.p95).toBe(100);
        expect(row.max).toBe(100);
        expect(row.totalSizeMb).toBe(7);
      });

      it('returns no rows for a connection without backups', async () => {
        const rows = await repository.getDailyBackupRows({
          from: '2026-03-10',
          toExclusive: '2026-03-11',
          connectionId: '00000000-0000-0000-0000-000000000799',
        });

        expect(rows).toEqual([]);
      });
    });
  });

  describe('getStorageByConnection', () => {
    it('orders by totalSizeMb descending, breaks ties by connectionId ascending, and excludes connections with no completed jobs', async () => {
      const highest = '00000000-0000-0000-0000-000000000901'; // 500 MB, alone at the top
      const tieLow = '00000000-0000-0000-0000-000000000902'; // 250 MB, lower id
      const tieHigh = '00000000-0000-0000-0000-000000000903'; // 250 MB, higher id
      const allFailed = '00000000-0000-0000-0000-000000000904'; // only a failed job

      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000a01',
        connectionId: highest,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:00:00',
        fileSizeMb: 500,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000a02',
        connectionId: tieHigh,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:00:00',
        fileSizeMb: 250,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000a03',
        connectionId: tieLow,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:00:00',
        fileSizeMb: 250,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000a04',
        connectionId: allFailed,
        status: JobStatus.FAILED,
        createdAt: '2026-03-10 08:00:00',
        fileSizeMb: 999,
      });

      const rows = await repository.getStorageByConnection();

      expect(rows.map((r) => r.connectionId)).toEqual([highest, tieLow, tieHigh]);
      expect(rows[0].totalSizeMb).toBe(500);
      expect(Number(rows[0].backupCount)).toBe(1);
    });

    it('reflects only the completed job when the same connection has both a completed and a failed backup', async () => {
      const mixed = '00000000-0000-0000-0000-000000000905';

      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000a05',
        connectionId: mixed,
        status: JobStatus.COMPLETED,
        createdAt: '2026-03-10 08:00:00',
        fileSizeMb: 100,
      });
      await insertBackupJob({
        id: '00000000-0000-0000-0000-000000000a06',
        connectionId: mixed,
        status: JobStatus.FAILED,
        createdAt: '2026-03-10 09:00:00',
        fileSizeMb: 50,
      });

      const rows = await repository.getStorageByConnection();
      const row = rows.find((r) => r.connectionId === mixed);

      expect(row).toBeDefined();
      expect(row?.totalSizeMb).toBe(100);
      expect(Number(row?.backupCount)).toBe(1);
    });
  });

  describe('countRestoreJobsByStatus', () => {
    it('counts restore jobs grouped by status', async () => {
      await insertRestoreJob('00000000-0000-0000-0000-000000000b01', JobStatus.PENDING);
      await insertRestoreJob('00000000-0000-0000-0000-000000000b02', JobStatus.PENDING);
      await insertRestoreJob('00000000-0000-0000-0000-000000000b03', JobStatus.RUNNING);
      await insertRestoreJob('00000000-0000-0000-0000-000000000b04', JobStatus.COMPLETED);
      await insertRestoreJob('00000000-0000-0000-0000-000000000b05', JobStatus.COMPLETED);
      await insertRestoreJob('00000000-0000-0000-0000-000000000b06', JobStatus.COMPLETED);

      const rows = await repository.countRestoreJobsByStatus();
      const byStatus = new Map(rows.map((r) => [r.status, Number(r.count)]));

      expect(byStatus.get(JobStatus.PENDING)).toBe(2);
      expect(byStatus.get(JobStatus.RUNNING)).toBe(1);
      expect(byStatus.get(JobStatus.COMPLETED)).toBe(3);
      expect(byStatus.has(JobStatus.FAILED)).toBe(false);
    });
  });
});
