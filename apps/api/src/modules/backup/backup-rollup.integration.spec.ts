import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { BackupDailyRollupEntity } from '../../database/entities/backup-daily-rollup.entity';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { RestoreJobEntity } from '../../database/entities/restore-job.entity';
import { Environment } from '../../database/enums/environment.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import {
  nextUtcDay,
  ParsedDailyRow,
  parseDailyRow,
  zeroFillDailySeries,
} from '../jobs/analytics/daily-series';
import { JobsAnalyticsRepository } from '../jobs/analytics/jobs-analytics.repository';
import { BackupRepository } from './backup.repository';

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

/** Adds fractional seconds to a `YYYY-MM-DD HH:MM:SS` UTC wall-clock string. */
function addSeconds(timestamp: string, seconds: number): string {
  const base = Date.parse(`${timestamp.replace(' ', 'T')}Z`);
  return new Date(base + seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');
}

const adminDatabaseUrl = resolveAdminDatabaseUrl();
const integration = adminDatabaseUrl ? describe : describe.skip;

const CONN_A = '00000000-0000-0000-0000-00000000a001';
const CONN_B = '00000000-0000-0000-0000-00000000b001';
const CONN_NONE = '00000000-0000-0000-0000-00000000f001';

const DAYS = [
  '2026-03-08',
  '2026-03-09',
  '2026-03-10',
  '2026-03-11',
  '2026-03-12',
  '2026-03-13',
  '2026-03-14',
];

interface SeedRow {
  key: string;
  connectionId: string;
  status: JobStatus;
  createdAt: string;
  /** Seconds between startedAt and completedAt; omit to leave both timestamps NULL. */
  durationSeconds?: number;
  sizeMb?: number;
}

/**
 * Two connections over four UTC days. Outlier sizes and durations on the rows
 * that must never reach a counter (failed size, pending and running timings)
 * make any leak into the wrong bucket change the series.
 */
const SEED: SeedRow[] = [
  // A, 2026-03-09: three timed completed jobs and one failed job.
  { key: 'a1', connectionId: CONN_A, status: JobStatus.COMPLETED, createdAt: '2026-03-09 08:00:00', durationSeconds: 10, sizeMb: 1 },
  { key: 'a2', connectionId: CONN_A, status: JobStatus.COMPLETED, createdAt: '2026-03-09 09:00:00', durationSeconds: 20, sizeMb: 2 },
  { key: 'a3', connectionId: CONN_A, status: JobStatus.COMPLETED, createdAt: '2026-03-09 10:00:00', durationSeconds: 30.5, sizeMb: 3 },
  { key: 'a4', connectionId: CONN_A, status: JobStatus.FAILED, createdAt: '2026-03-09 11:00:00', durationSeconds: 5, sizeMb: 999 },
  // A, 2026-03-10: two timed completed jobs, one completed without timestamps, two failed, pending and running.
  { key: 'a5', connectionId: CONN_A, status: JobStatus.COMPLETED, createdAt: '2026-03-10 08:00:00', durationSeconds: 40, sizeMb: 4.5 },
  { key: 'a6', connectionId: CONN_A, status: JobStatus.COMPLETED, createdAt: '2026-03-10 09:00:00', durationSeconds: 50.25, sizeMb: 5.5 },
  { key: 'a7', connectionId: CONN_A, status: JobStatus.COMPLETED, createdAt: '2026-03-10 10:00:00', sizeMb: 7 },
  { key: 'a8', connectionId: CONN_A, status: JobStatus.FAILED, createdAt: '2026-03-10 11:00:00', durationSeconds: 5, sizeMb: 999 },
  { key: 'a9', connectionId: CONN_A, status: JobStatus.FAILED, createdAt: '2026-03-10 12:00:00' },
  { key: 'a10', connectionId: CONN_A, status: JobStatus.PENDING, createdAt: '2026-03-10 13:00:00', durationSeconds: 1000, sizeMb: 5000 },
  { key: 'a11', connectionId: CONN_A, status: JobStatus.RUNNING, createdAt: '2026-03-10 14:00:00', durationSeconds: 2000, sizeMb: 6000 },
  // A, 2026-03-12: a day with only a failed job.
  { key: 'a12', connectionId: CONN_A, status: JobStatus.FAILED, createdAt: '2026-03-12 08:00:00' },
  // B, 2026-03-10: two timed completed jobs and one failed job.
  { key: 'b1', connectionId: CONN_B, status: JobStatus.COMPLETED, createdAt: '2026-03-10 08:00:00', durationSeconds: 5, sizeMb: 10 },
  { key: 'b2', connectionId: CONN_B, status: JobStatus.COMPLETED, createdAt: '2026-03-10 09:00:00', durationSeconds: 100, sizeMb: 20 },
  { key: 'b3', connectionId: CONN_B, status: JobStatus.FAILED, createdAt: '2026-03-10 10:00:00' },
  // B, 2026-03-11: one timed completed job.
  { key: 'b4', connectionId: CONN_B, status: JobStatus.COMPLETED, createdAt: '2026-03-11 08:00:00', durationSeconds: 60, sizeMb: 2.5 },
  // B, 2026-03-13: a day with only a pending job.
  { key: 'b5', connectionId: CONN_B, status: JobStatus.PENDING, createdAt: '2026-03-13 13:00:00' },
];

type SeriesSnapshot = Record<'all' | 'A' | 'B' | 'none', ParsedDailyRow[]>;

integration('backup daily rollup PostgreSQL integration', () => {
  // A uniquely-named throwaway database per run, built from the real
  // migration chain (never hand-written DDL) so the statements in
  // BackupRepository and JobsAnalyticsRepository run against the exact column
  // types production has (enum-typed status, timestamp-without-tz columns).
  const databaseName = `backup_rollup_it_${process.pid}_${Date.now()}`;

  let adminDataSource: DataSource;
  let dataSource: DataSource;
  let backupRepository: BackupRepository;
  let analyticsRepository: JobsAnalyticsRepository;

  beforeAll(async () => {
    const url = adminDatabaseUrl ?? '';
    adminDataSource = new DataSource({ type: 'postgres', url });
    await adminDataSource.initialize();
    await adminDataSource.query(`CREATE DATABASE "${databaseName}"`);

    const testDatabaseUrl = withDatabaseName(url, databaseName);

    const migrationsDataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      migrations: [join(__dirname, '../../database/migrations/*{.ts,.js}')],
    });
    await migrationsDataSource.initialize();
    await migrationsDataSource.runMigrations();
    await migrationsDataSource.destroy();

    // The default pool (more than one connection) lets the concurrency tests
    // run two purge statements in parallel.
    dataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      entities: [BackupJobEntity, BackupDailyRollupEntity, RestoreJobEntity],
    });
    await dataSource.initialize();

    backupRepository = new BackupRepository(dataSource.getRepository(BackupJobEntity), dataSource);
    analyticsRepository = new JobsAnalyticsRepository(
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
    await seed();
  });

  /** Inserts the seed with raw SQL; ids and file keys derive from the row key. */
  async function seed(): Promise<void> {
    for (const row of SEED) {
      const startedAt = row.durationSeconds === undefined ? null : row.createdAt;
      const completedAt =
        row.durationSeconds === undefined ? null : addSeconds(row.createdAt, row.durationSeconds);
      await dataSource.query(
        `INSERT INTO backup_jobs
           (id, "connectionId", environment, status, "fileKey", "triggeredBy", "fileSizeMb", "startedAt", "completedAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, 'rollup-test', $6, $7, $8, $9::timestamp)`,
        [
          idOf(row.key),
          row.connectionId,
          Environment.PROD,
          row.status,
          keyOf(row.key),
          row.sizeMb ?? null,
          startedAt,
          completedAt,
          row.createdAt,
        ],
      );
    }
  }

  function idOf(rowKey: string): string {
    const index = SEED.findIndex((row) => row.key === rowKey);
    return `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
  }

  function keyOf(rowKey: string): string {
    return `rollup-it/${rowKey}.dump`;
  }

  const allKeys = SEED.map((row) => row.key);
  const ids = (rowKeys: string[]): string[] => rowKeys.map(idOf);
  const fileKeys = (rowKeys: string[]): string[] => rowKeys.map(keyOf);

  async function readSeries(connectionId?: string): Promise<ParsedDailyRow[]> {
    const rawRows = await analyticsRepository.getDailyBackupRows({
      from: DAYS[0],
      toExclusive: nextUtcDay(DAYS[DAYS.length - 1]),
      connectionId,
    });
    return zeroFillDailySeries(DAYS, rawRows.map(parseDailyRow));
  }

  /** The series the API serves for every connection, A, B and a connection with no jobs. */
  async function snapshot(): Promise<SeriesSnapshot> {
    return {
      all: await readSeries(),
      A: await readSeries(CONN_A),
      B: await readSeries(CONN_B),
      none: await readSeries(CONN_NONE),
    };
  }

  /** Reads the series before the purge and guards against a trivially empty baseline. */
  async function baseline(): Promise<SeriesSnapshot> {
    const before = await snapshot();
    expect(before.all.reduce((sum, day) => sum + day.completed, 0)).toBeGreaterThan(0);
    expect(before.A.reduce((sum, day) => sum + day.failed, 0)).toBeGreaterThan(0);
    expect(before.B.reduce((sum, day) => sum + day.completed, 0)).toBeGreaterThan(0);
    expect(before.none.every((day) => day.completed === 0 && day.failed === 0)).toBe(true);
    return before;
  }

  async function countJobs(): Promise<number> {
    const [row] = await dataSource.query<{ count: string }[]>('SELECT COUNT(*) AS count FROM backup_jobs');
    return Number(row.count);
  }

  interface RollupRow {
    connectionId: string;
    day: string;
    completed: number;
    failed: number;
    totalSizeMb: number;
    durationsSeconds: number[];
  }

  /** Durations come back sorted: the array order inside a rollup row carries no meaning. */
  async function readRollups(): Promise<RollupRow[]> {
    const rows = await dataSource.query<RollupRow[]>(
      `SELECT "connectionId", to_char(day, 'YYYY-MM-DD') AS day, completed, failed,
              "totalSizeMb", "durationsSeconds"
       FROM backup_daily_rollups
       ORDER BY "connectionId", day`,
    );
    return rows.map((row) => ({
      ...row,
      durationsSeconds: [...row.durationsSeconds].sort((a, b) => a - b),
    }));
  }

  describe('full purge through deleteByFileKeys (retention path)', () => {
    it('keeps the daily series identical for every connection and the connection filter', async () => {
      const before = await baseline();

      const deleted = await backupRepository.deleteByFileKeys(fileKeys(allKeys));

      expect(deleted).toBe(SEED.length);
      expect(await countJobs()).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it('serves the exact counts, size and percentiles from the rollup alone', async () => {
      await backupRepository.deleteByFileKeys(fileKeys(allKeys));

      const rows = await analyticsRepository.getDailyBackupRows({
        from: '2026-03-10',
        toExclusive: '2026-03-11',
        connectionId: CONN_A,
      });

      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.date).toBe('2026-03-10');
      // a5 + a6 + a7 (untimed) completed, a8 + a9 failed; pending/running ignored.
      expect(Number(row.completed)).toBe(3);
      expect(Number(row.failed)).toBe(2);
      expect(row.totalSizeMb).toBe(17);
      // Durations 40 and 50.25: only the two timed completed rows feed the percentiles.
      expect(row.p50).toBeCloseTo(45.125, 6);
      expect(row.p95).toBeCloseTo(49.7375, 6);
      expect(row.max).toBe(50.25);
      expect(typeof row.completed).toBe('string');
      expect(typeof row.p50).toBe('number');
    });

    it('stores one rollup row per connection and day, with the purged durations', async () => {
      await backupRepository.deleteByFileKeys(fileKeys(allKeys));

      const rollups = await readRollups();

      expect(rollups).toEqual([
        { connectionId: CONN_A, day: '2026-03-09', completed: 3, failed: 1, totalSizeMb: 6, durationsSeconds: [10, 20, 30.5] },
        { connectionId: CONN_A, day: '2026-03-10', completed: 3, failed: 2, totalSizeMb: 17, durationsSeconds: [40, 50.25] },
        { connectionId: CONN_A, day: '2026-03-12', completed: 0, failed: 1, totalSizeMb: 0, durationsSeconds: [] },
        { connectionId: CONN_B, day: '2026-03-10', completed: 2, failed: 1, totalSizeMb: 30, durationsSeconds: [5, 100] },
        { connectionId: CONN_B, day: '2026-03-11', completed: 1, failed: 0, totalSizeMb: 2.5, durationsSeconds: [60] },
      ]);
    });

    it('leaves storage-by-connection live-only', async () => {
      expect((await analyticsRepository.getStorageByConnection()).length).toBeGreaterThan(0);

      await backupRepository.deleteByFileKeys(fileKeys(allKeys));

      expect(await analyticsRepository.getStorageByConnection()).toEqual([]);
    });

    it('purges nothing and writes nothing for keys that match no row', async () => {
      const before = await baseline();

      expect(await backupRepository.deleteByFileKeys(['rollup-it/missing.dump'])).toBe(0);
      expect(await backupRepository.deleteByFileKeys([])).toBe(0);

      expect(await readRollups()).toEqual([]);
      expect(await countJobs()).toBe(SEED.length);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('partial purges', () => {
    it('keeps the series when one whole day of one connection is purged', async () => {
      const before = await baseline();

      const deleted = await backupRepository.deleteByFileKeys(
        fileKeys(['a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11']),
      );

      expect(deleted).toBe(7);
      expect(await countJobs()).toBe(SEED.length - 7);
      expect(await snapshot()).toEqual(before);
      expect((await readRollups()).map((r) => `${r.connectionId}/${r.day}`)).toEqual([
        `${CONN_A}/2026-03-10`,
      ]);
    });

    it('keeps the series when a day is only partially purged, merging live and rolled-up rows', async () => {
      const before = await baseline();

      // The oldest two completed jobs of A on 2026-03-10 go; a6, a7 and the failed jobs stay live.
      await backupRepository.deleteByFileKeys(fileKeys(['a5', 'a8']));

      expect(await countJobs()).toBe(SEED.length - 2);
      expect(await snapshot()).toEqual(before);
      expect(await readRollups()).toEqual([
        { connectionId: CONN_A, day: '2026-03-10', completed: 1, failed: 1, totalSizeMb: 4.5, durationsSeconds: [40] },
      ]);
    });

    it('does not leak the purge of one connection into another connection', async () => {
      const before = await baseline();

      await backupRepository.deleteByFileKeys(fileKeys(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']));

      const rollups = await readRollups();
      expect(rollups.every((r) => r.connectionId === CONN_A)).toBe(true);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('deleteByIds (reconcile path)', () => {
    it('keeps the daily series identical', async () => {
      const before = await baseline();

      const deleted = await backupRepository.deleteByIds(ids(allKeys));

      expect(deleted).toBe(SEED.length);
      expect(await countJobs()).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it('purges nothing for ids that match no row', async () => {
      expect(await backupRepository.deleteByIds(['00000000-0000-0000-0000-0000000fffff'])).toBe(0);
      expect(await backupRepository.deleteByIds([])).toBe(0);
      expect(await readRollups()).toEqual([]);
    });
  });

  describe('deleteFailedOlderThan (DB hygiene path)', () => {
    // Failed jobs sit mid-day on 2026-03-09/10 and at 08:00 on 2026-03-12, so a
    // cutoff at noon on 2026-03-11 is unambiguous in any process time zone.
    const cutoff = new Date('2026-03-11T12:00:00Z');

    it('keeps the daily series identical and rolls up only the failed jobs', async () => {
      const before = await baseline();

      const deleted = await backupRepository.deleteFailedOlderThan(cutoff);

      // a4, a8, a9 and b3; a12 is newer than the cutoff.
      expect(deleted).toBe(4);
      expect(await countJobs()).toBe(SEED.length - 4);
      expect(await snapshot()).toEqual(before);

      const rollups = await readRollups();
      expect(rollups.every((r) => r.completed === 0 && r.totalSizeMb === 0 && r.durationsSeconds.length === 0)).toBe(true);
      expect(rollups.reduce((sum, r) => sum + r.failed, 0)).toBe(4);
    });

    it('purges nothing when no failed job is older than the cutoff', async () => {
      const before = await baseline();

      expect(await backupRepository.deleteFailedOlderThan(new Date('2026-03-01T00:00:00Z'))).toBe(0);

      expect(await readRollups()).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('repeated and concurrent purges', () => {
    it('adds counts and merges durations when two purges hit the same day', async () => {
      const before = await baseline();

      await backupRepository.deleteByFileKeys(fileKeys(['a5', 'a8']));
      await backupRepository.deleteByIds(ids(['a6', 'a7', 'a9']));

      expect(await readRollups()).toEqual([
        { connectionId: CONN_A, day: '2026-03-10', completed: 3, failed: 2, totalSizeMb: 17, durationsSeconds: [40, 50.25] },
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('then keeps adding when hygiene purges the same day a third time', async () => {
      const before = await baseline();

      await backupRepository.deleteByFileKeys(fileKeys(['a5']));
      await backupRepository.deleteByIds(ids(['a6', 'a7']));
      await backupRepository.deleteFailedOlderThan(new Date('2026-03-11T12:00:00Z'));

      const dayRows = (await readRollups()).filter((r) => r.connectionId === CONN_A && r.day === '2026-03-10');
      expect(dayRows).toEqual([
        { connectionId: CONN_A, day: '2026-03-10', completed: 3, failed: 2, totalSizeMb: 17, durationsSeconds: [40, 50.25] },
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('rolls up each row exactly once when two unlocked purges delete the same rows', async () => {
      const before = await baseline();

      const results = await Promise.all([
        backupRepository.deleteByIds(ids(allKeys)),
        backupRepository.deleteByIds([...ids(allKeys)].reverse()),
      ]);

      // DELETE ... RETURNING yields each row once: the counts add up to the seed size.
      expect(results[0] + results[1]).toBe(SEED.length);
      expect(await countJobs()).toBe(0);
      expect(await snapshot()).toEqual(before);
    });

    it('merges concurrent purges of different rows that share the same days', async () => {
      const before = await baseline();

      const firstHalf = ['a1', 'a5', 'a8', 'b1', 'b3', 'a12'];
      const secondHalf = allKeys.filter((key) => !firstHalf.includes(key));
      const results = await Promise.all([
        backupRepository.deleteByIds(ids(firstHalf)),
        backupRepository.deleteByIds(ids(secondHalf)),
      ]);

      expect(results[0] + results[1]).toBe(SEED.length);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe('which rows are aggregated', () => {
    it('deletes pending and running jobs without counting them', async () => {
      const before = await baseline();

      const deleted = await backupRepository.deleteByIds(ids(['a10', 'a11', 'b5']));

      expect(deleted).toBe(3);
      expect(await readRollups()).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });

    it('does not count a purged pending job next to purged completed ones', async () => {
      const before = await baseline();

      await backupRepository.deleteByIds(ids(['a5', 'a6', 'a7', 'a10', 'a11']));

      expect(await readRollups()).toEqual([
        { connectionId: CONN_A, day: '2026-03-10', completed: 3, failed: 0, totalSizeMb: 17, durationsSeconds: [40, 50.25] },
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('counts a completed job without timestamps but adds no duration', async () => {
      const before = await baseline();

      await backupRepository.deleteByIds(ids(['a7']));

      expect(await readRollups()).toEqual([
        { connectionId: CONN_A, day: '2026-03-10', completed: 1, failed: 0, totalSizeMb: 7, durationsSeconds: [] },
      ]);
      expect(await snapshot()).toEqual(before);
    });

    it('keeps a day with only untimed completed jobs at null durations', async () => {
      await dataSource.query('DELETE FROM backup_jobs');
      await dataSource.query(
        `INSERT INTO backup_jobs (id, "connectionId", environment, status, "fileKey", "triggeredBy", "fileSizeMb", "createdAt")
         VALUES ('00000000-0000-0000-0000-0000000e0001', $1, $2, $3, 'rollup-it/untimed.dump', 'rollup-test', 12, '2026-03-12 08:00:00')`,
        [CONN_A, Environment.PROD, JobStatus.COMPLETED],
      );
      const before = await readSeries(CONN_A);

      await backupRepository.deleteByIds(['00000000-0000-0000-0000-0000000e0001']);

      const after = await readSeries(CONN_A);
      expect(after).toEqual(before);
      const day = after.find((d) => d.date === '2026-03-12');
      expect(day).toMatchObject({
        completed: 1,
        failed: 0,
        p50DurationSeconds: null,
        p95DurationSeconds: null,
        maxDurationSeconds: null,
        totalSizeMb: 12,
      });
    });
  });
});
