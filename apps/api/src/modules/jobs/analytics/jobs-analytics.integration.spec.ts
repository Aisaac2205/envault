import { join } from 'node:path';
import { DataSource } from 'typeorm';
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
      entities: [BackupJobEntity, RestoreJobEntity],
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
      expect(row.totalSizeMb).toBe(105);
    });

    it('returns node-pg shapes matching the raw row contract (bigint counts as strings, floats as numbers)', async () => {
      const [row] = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

      expect(typeof row.completed).toBe('string');
      expect(typeof row.failed).toBe('string');
      expect(typeof row.p50).toBe('number');
      expect(typeof row.p95).toBe('number');
      expect(typeof row.totalSizeMb).toBe('number');
    });

    it('produces the same result regardless of the session TimeZone (columns are timestamp without tz)', async () => {
      const utcResult = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });

      await dataSource.query(`SET TIME ZONE 'America/Guatemala'`);
      const guatemalaResult = await repository.getDailyBackupRows({ from: '2026-03-10', toExclusive: '2026-03-11' });
      await dataSource.query(`SET TIME ZONE 'UTC'`);

      expect(guatemalaResult).toEqual(utcResult);
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
