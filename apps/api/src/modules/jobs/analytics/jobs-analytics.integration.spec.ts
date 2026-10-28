import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { BackupDailyRollupEntity } from '../../../database/entities/backup-daily-rollup.entity';
import { BackupJobEntity } from '../../../database/entities/backup-job.entity';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { RestoreJobEntity } from '../../../database/entities/restore-job.entity';
import { DbTypeEnum } from '../../../database/enums/db-type.enum';
import { Environment } from '../../../database/enums/environment.enum';
import { JobStatus } from '../../../database/enums/job-status.enum';
import { nextUtcDay } from './daily-series';
import { JobsAnalyticsRepository } from './jobs-analytics.repository';
import { JobsAnalyticsService } from './jobs-analytics.service';

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
  let service: JobsAnalyticsService;

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
      entities: [BackupJobEntity, BackupDailyRollupEntity, RestoreJobEntity, ConnectionEntity],
      extra: { max: 1 },
    });
    await dataSource.initialize();

    repository = new JobsAnalyticsRepository(
      dataSource.getRepository(BackupJobEntity),
      dataSource.getRepository(RestoreJobEntity),
    );
    service = new JobsAnalyticsService(repository, dataSource.getRepository(ConnectionEntity));
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
    await dataSource.query('DELETE FROM cronjobs');
    await dataSource.query('DELETE FROM connections');
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

  async function insertConnection(row: {
    id: string;
    name: string;
    environment?: Environment;
    isActive?: boolean;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO connections
         (id, name, slug, environment, "dbType", host, port, database, username, password, "isActive")
       VALUES ($1, $2, $3, $4, $5, 'localhost', 5432, 'appdb', 'analytics-test', 'not-a-real-secret', $6)`,
      [
        row.id,
        row.name,
        `slug-${row.id}`,
        row.environment ?? Environment.PROD,
        DbTypeEnum.POSTGRES,
        row.isActive ?? true,
      ],
    );
  }

  async function insertCronjob(row: {
    id: string;
    connectionId: string;
    cronExpression: string;
    createdAt: string;
    isActive?: boolean;
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    lastStatus?: JobStatus | null;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO cronjobs
         (id, name, "connectionId", "cronExpression", frequency, "isActive", "lastRunAt", "nextRunAt", "lastStatus", "createdAt")
       VALUES ($1, $2, $3, $4, 'custom', $5, $6::timestamp, $7::timestamp, $8, $9::timestamp)`,
      [
        row.id,
        `cron ${row.id}`,
        row.connectionId,
        row.cronExpression,
        row.isActive ?? true,
        row.lastRunAt ?? null,
        row.nextRunAt ?? null,
        row.lastStatus ?? null,
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

  describe('getConnectionsHealth', () => {
    const NOW = new Date('2026-03-20T12:00:00.000Z'); // window 7 = 2026-03-14 .. 2026-03-20

    const ALPHA = '00000000-0000-0000-0000-000000001001'; // prod, active: live + rollup + pending/running rows
    const BRAVO = '00000000-0000-0000-0000-000000001002'; // prod, active: no job at all
    const CHARLIE = '00000000-0000-0000-0000-000000001003'; // prod, INACTIVE: has jobs
    const DELTA = '00000000-0000-0000-0000-000000001004'; // active but dev: has jobs
    const FOXTROT = '00000000-0000-0000-0000-000000001006'; // prod, active: only pending and running jobs

    /** `YYYY-MM-DD HH:MM:SS` plus `seconds`, as a wall-clock string. */
    function plusSeconds(timestamp: string, seconds: number): string {
      const millis = Date.parse(`${timestamp.replace(' ', 'T')}Z`) + seconds * 1000;
      return new Date(millis).toISOString().slice(0, 19).replace('T', ' ');
    }

    let jobSequence = 0;
    /** A job created at `createdAt` that started then and ran for `seconds` (null: never started). */
    async function job(
      connectionId: string,
      status: JobStatus,
      createdAt: string,
      seconds: number | null,
      fileSizeMb: number | null = null,
    ): Promise<void> {
      jobSequence += 1;
      await insertBackupJob({
        id: `00000000-0000-0000-0000-0000000020${String(jobSequence).padStart(2, '0')}`,
        connectionId,
        status,
        createdAt,
        startedAt: seconds === null ? null : createdAt,
        completedAt: seconds === null ? null : plusSeconds(createdAt, seconds),
        fileSizeMb,
      });
    }

    beforeEach(async () => {
      jobSequence = 0;
      await insertConnection({ id: ALPHA, name: 'Alpha' });
      await insertConnection({ id: BRAVO, name: 'bravo' });
      await insertConnection({ id: CHARLIE, name: 'Charlie', isActive: false });
      await insertConnection({ id: DELTA, name: 'Delta', environment: Environment.DEV });
      await insertConnection({ id: FOXTROT, name: 'Foxtrot' });

      // Alpha, live rows inside the window: three completed (10, 20, 30 s) and a failed one.
      await job(ALPHA, JobStatus.COMPLETED, '2026-03-18 08:00:00', 10, 10);
      await job(ALPHA, JobStatus.COMPLETED, '2026-03-18 09:00:00', 20, 20);
      await job(ALPHA, JobStatus.COMPLETED, '2026-03-18 10:00:00', 30, 30);
      await job(ALPHA, JobStatus.FAILED, '2026-03-19 09:00:00', 5, 999);
      // Pending and running rows are the newest of all, and carry full timestamps and
      // outlier values so that any leak into the counts or the last backup shows up.
      await job(ALPHA, JobStatus.PENDING, '2026-03-20 11:00:00', 1000, 5000);
      await job(ALPHA, JobStatus.RUNNING, '2026-03-20 11:30:00', 2000, 6000);
      // Just before the window: a live row and a rollup day that must not count.
      await job(ALPHA, JobStatus.COMPLETED, '2026-03-13 23:59:59', 999, 999);
      await insertRollup({ connectionId: ALPHA, day: '2026-03-13', completed: 9, failed: 9, totalSizeMb: 999, durationsSeconds: [999] });
      // Alpha, purged rows (rollup) inside the window: two completed (40, 50 s) and one failed.
      await insertRollup({ connectionId: ALPHA, day: '2026-03-15', completed: 2, failed: 1, totalSizeMb: 90, durationsSeconds: [40, 50] });

      // Charlie (inactive) and Delta (dev) have jobs, which the overall figures still count.
      await job(CHARLIE, JobStatus.COMPLETED, '2026-03-16 12:00:00', 60, 7);
      await job(DELTA, JobStatus.COMPLETED, '2026-03-17 12:00:00', 70, 7);
      await job(DELTA, JobStatus.FAILED, '2026-03-17 13:00:00', 3, 7);

      // Foxtrot never finished anything.
      await job(FOXTROT, JobStatus.PENDING, '2026-03-20 08:00:00', null);
      await job(FOXTROT, JobStatus.RUNNING, '2026-03-20 08:30:00', null);

      await insertCronjob({
        id: '00000000-0000-0000-0000-000000003001',
        connectionId: ALPHA,
        cronExpression: '0 * * * *',
        createdAt: '2026-03-01 00:00:01',
        lastRunAt: '2026-03-20 12:00:00',
        nextRunAt: '2026-03-20 13:00:00',
        lastStatus: JobStatus.COMPLETED,
      });
      await insertCronjob({
        id: '00000000-0000-0000-0000-000000003002',
        connectionId: ALPHA,
        cronExpression: '30 2 * * *',
        createdAt: '2026-03-01 00:00:02',
      });
      await insertCronjob({
        id: '00000000-0000-0000-0000-000000003003',
        connectionId: ALPHA,
        cronExpression: '0 9 * * 1',
        createdAt: '2026-03-01 00:00:03',
        isActive: false,
      });
      await insertCronjob({
        id: '00000000-0000-0000-0000-000000003004',
        connectionId: BRAVO,
        cronExpression: '30 2 * * *',
        createdAt: '2026-03-01 00:00:04',
      });
      await insertCronjob({
        id: '00000000-0000-0000-0000-000000003005',
        connectionId: CHARLIE,
        cronExpression: '0 * * * *',
        createdAt: '2026-03-01 00:00:05',
      });
    });

    it('lists only active production connections, ordered by name regardless of case', async () => {
      const { connections } = await service.getConnectionsHealth(7, NOW);

      expect(connections.map((c) => [c.connectionId, c.connectionName, c.environment, c.dbType])).toEqual([
        [ALPHA, 'Alpha', 'prod', 'postgres'],
        [BRAVO, 'bravo', 'prod', 'postgres'],
        [FOXTROT, 'Foxtrot', 'prod', 'postgres'],
      ]);
    });

    it('counts a connection window over the live rows and the rollup, with exact percentiles', async () => {
      const { connections } = await service.getConnectionsHealth(7, NOW);
      const alpha = connections.find((c) => c.connectionId === ALPHA);

      // Completed: 3 live + 2 rolled up. Failed: 1 live + 1 rolled up.
      // Durations 10, 20, 30 (live) and 40, 50 (rollup): median 30, 95th percentile 40 + 0.8 * 10.
      expect(alpha).toMatchObject({
        completed: 5,
        failed: 2,
        successRate: 0.7143,
        p50DurationSeconds: 30,
        p95DurationSeconds: 48,
      });
    });

    it('excludes the rows and the rollup days outside the window, and includes them in a wider one', async () => {
      const [narrow, wide] = await Promise.all([service.getConnectionsHealth(7, NOW), service.getConnectionsHealth(30, NOW)]);

      expect(narrow.connections[0]).toMatchObject({ completed: 5, failed: 2 });
      // + the live row and the rollup day of 2026-03-13 (1 + 9 completed, 9 failed).
      expect(wide.connections[0]).toMatchObject({ completed: 15, failed: 11 });
      expect(wide.connections[0].p95DurationSeconds).toBeGreaterThan(900);
    });

    it('keeps a connection with no job in the window, with zeros and nulls and no last backup', async () => {
      const { connections } = await service.getConnectionsHealth(7, NOW);
      const bravo = connections.find((c) => c.connectionId === BRAVO);

      expect(bravo).toMatchObject({
        completed: 0,
        failed: 0,
        successRate: null,
        p50DurationSeconds: null,
        p95DurationSeconds: null,
        lastBackup: null,
        lastSuccessAt: null,
      });
    });

    it('ignores pending and running rows in the counts, the percentiles and the last backup', async () => {
      const { connections } = await service.getConnectionsHealth(7, NOW);
      const alpha = connections.find((c) => c.connectionId === ALPHA);
      const foxtrot = connections.find((c) => c.connectionId === FOXTROT);

      // Alpha's newest row is a running one: the last backup is the failed row of 2026-03-19.
      expect(alpha?.lastBackup).toEqual({
        status: 'failed',
        createdAt: '2026-03-19T09:00:00.000Z',
        completedAt: '2026-03-19T09:00:05.000Z',
        durationSeconds: 5,
        fileSizeMb: 999,
      });
      expect(alpha?.lastSuccessAt).toBe('2026-03-18T10:00:30.000Z');
      expect(foxtrot).toMatchObject({ completed: 0, failed: 0, lastBackup: null, lastSuccessAt: null });
    });

    it('reports the last backup of any age, even outside the window', async () => {
      await dataSource.query('DELETE FROM backup_jobs WHERE "connectionId" = $1', [ALPHA]);
      await job(ALPHA, JobStatus.COMPLETED, '2025-12-24 03:00:00', 42, 3);

      const alpha = (await service.getConnectionsHealth(7, NOW)).connections.find((c) => c.connectionId === ALPHA);

      expect(alpha).toMatchObject({ completed: 2, failed: 1, lastSuccessAt: '2025-12-24T03:00:42.000Z' });
      expect(alpha?.lastBackup).toMatchObject({ status: 'completed', createdAt: '2025-12-24T03:00:00.000Z', durationSeconds: 42 });
    });

    it('reports only the active schedules of each connection, oldest first, with their interval', async () => {
      const { connections } = await service.getConnectionsHealth(7, NOW);
      const byId = new Map(connections.map((c) => [c.connectionId, c]));

      expect(byId.get(ALPHA)?.schedules).toEqual([
        {
          cronjobId: '00000000-0000-0000-0000-000000003001',
          nextRunAt: '2026-03-20T13:00:00.000Z',
          lastRunAt: '2026-03-20T12:00:00.000Z',
          lastStatus: 'completed',
          intervalSeconds: 3_600,
        },
        {
          cronjobId: '00000000-0000-0000-0000-000000003002',
          nextRunAt: null,
          lastRunAt: null,
          lastStatus: null,
          intervalSeconds: 86_400,
        },
      ]);
      expect(byId.get(BRAVO)?.schedules.map((s) => s.cronjobId)).toEqual(['00000000-0000-0000-0000-000000003004']);
      expect(byId.get(FOXTROT)?.schedules).toEqual([]);
    });

    it('derives the freshness from the smallest interval and the last success', async () => {
      const [alpha, bravo, foxtrot] = (await service.getConnectionsHealth(7, NOW)).connections;

      // Hourly schedule, last success two days ago.
      expect(alpha.freshness).toBe('stale');
      // A schedule and no success at all.
      expect(bravo.freshness).toBe('stale');
      // No schedule.
      expect(foxtrot.freshness).toBe('unknown');

      await job(FOXTROT, JobStatus.COMPLETED, '2026-03-20 10:30:00', 20, 1);
      await insertCronjob({
        id: '00000000-0000-0000-0000-000000003006',
        connectionId: FOXTROT,
        cronExpression: '0 * * * *',
        createdAt: '2026-03-01 00:00:06',
      });
      const fresh = (await service.getConnectionsHealth(7, NOW)).connections.find((c) => c.connectionId === FOXTROT);

      // Succeeded at 10:30:20, one hour 29 minutes 40 seconds before NOW: within 1.5 intervals.
      expect(fresh?.freshness).toBe('ok');
    });

    it('computes the overall figures over every connection of the source, like the daily series', async () => {
      const { overall } = await service.getConnectionsHealth(7, NOW);

      // Alpha 5/2 + Charlie 1/0 + Delta 1/1; durations 10..70 in steps of 10.
      expect(overall).toEqual({
        completed: 7,
        failed: 3,
        successRate: 0.7,
        p50DurationSeconds: 40,
        p95DurationSeconds: 67,
      });
    });

    it('returns an overall row of zeros and nulls even when no job exists', async () => {
      await dataSource.query('DELETE FROM backup_jobs');
      await dataSource.query('DELETE FROM backup_daily_rollups');

      const rows = await repository.getWindowStatsRows({ from: '2026-03-14', toExclusive: '2026-03-21' });
      const { overall } = await service.getConnectionsHealth(7, NOW);

      expect(rows).toEqual([{ isOverall: true, connectionId: null, completed: '0', failed: '0', p50: null, p95: null }]);
      expect(overall).toEqual({ completed: 0, failed: 0, successRate: null, p50DurationSeconds: null, p95DurationSeconds: null });
    });

    it.each([7, 30, 90] as const)('shares its source with the daily query: window=%i daily totals equal the health counts', async (window) => {
      const health = await service.getConnectionsHealth(window, NOW);
      const range = { from: health.from, toExclusive: nextUtcDay(health.to) };
      const sum = (rows: { completed: string; failed: string }[], key: 'completed' | 'failed') =>
        rows.reduce((total, row) => total + Number(row[key]), 0);

      const daily = await repository.getDailyBackupRows(range);
      expect(sum(daily, 'completed')).toBe(health.overall.completed);
      expect(sum(daily, 'failed')).toBe(health.overall.failed);

      for (const connection of health.connections) {
        const scoped = await repository.getDailyBackupRows({ ...range, connectionId: connection.connectionId });
        expect({ id: connection.connectionId, completed: sum(scoped, 'completed'), failed: sum(scoped, 'failed') }).toEqual({
          id: connection.connectionId,
          completed: connection.completed,
          failed: connection.failed,
        });
      }
    });

    it('computes the same counts and percentiles as the daily query over a one-day range that mixes live and rolled-up rows', async () => {
      // 2026-03-18 holds Alpha's live durations 10, 20, 30 s; add the purged 40 and 50 s of the same day.
      await insertRollup({ connectionId: ALPHA, day: '2026-03-18', completed: 2, failed: 0, totalSizeMb: 1, durationsSeconds: [40, 50] });
      const range = { from: '2026-03-18', toExclusive: '2026-03-19' };

      const [day] = await repository.getDailyBackupRows(range);
      const rows = await repository.getWindowStatsRows(range);
      const overall = rows.find((row) => row.isOverall);
      const alpha = rows.find((row) => row.connectionId === ALPHA);

      expect(day).toMatchObject({ completed: '5', failed: '0', p50: 30, p95: 48 });
      for (const row of [overall, alpha]) {
        expect(row).toMatchObject({ completed: day.completed, failed: day.failed, p50: day.p50, p95: day.p95 });
      }
    });

    it('is independent of the session TimeZone (columns are timestamp without tz, read as UTC)', async () => {
      const utc = await service.getConnectionsHealth(7, NOW);

      await dataSource.query(`SET TIME ZONE 'America/Guatemala'`);
      const guatemala = await service.getConnectionsHealth(7, NOW);
      await dataSource.query(`SET TIME ZONE 'Asia/Tokyo'`);
      const tokyo = await service.getConnectionsHealth(7, NOW);
      await dataSource.query(`SET TIME ZONE 'UTC'`);

      expect(guatemala).toEqual(utc);
      expect(tokyo).toEqual(utc);
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
