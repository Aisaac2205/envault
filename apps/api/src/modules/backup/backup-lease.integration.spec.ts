import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { BackupJobEntity, STORAGE_KEY_VERSION } from '../../database/entities/backup-job.entity';
import { JobStatus } from '../../database/enums/job-status.enum';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { BackupLeaseRepository } from './backup-lease.repository';
import { BackupRepository } from './backup.repository';
import { BackupJobsPendingUnique1778716800022 } from '../../database/migrations/1778716800022-backup-jobs-pending-unique';

function resolveAdminDatabaseUrl(): string | null {
  const value = process.env.BACKUP_LEASE_TEST_DATABASE_URL;
  if (!value) return null;

  const url = new URL(value);
  const isTestServer =
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname === 'localhost' &&
    url.port === '5434' &&
    url.pathname === '/testdb' &&
    url.username === 'test_user';

  if (!isTestServer) {
    throw new Error('BACKUP_LEASE_TEST_DATABASE_URL must target the local test database');
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

integration('backup lease PostgreSQL integration', () => {
  // A uniquely-named throwaway database per run: this suite builds its own
  // schema from the real migration chain (see beforeAll), so it no longer
  // needs an empty shared `/testdb` and can never collide with the
  // restore-lease/audit integration suites that also run against that server.
  const databaseName = `backup_lease_it_${process.pid}_${Date.now()}`;
  const connectionId = '00000000-0000-0000-0000-000000000301';
  const pendingUniqueMigration = new BackupJobsPendingUnique1778716800022();

  let adminDataSource: DataSource;
  let firstDataSource: DataSource;
  let secondDataSource: DataSource;
  let firstRepository: BackupLeaseRepository;
  let secondRepository: BackupLeaseRepository;
  let firstBackupRepository: BackupRepository;
  let secondBackupRepository: BackupRepository;

  beforeAll(async () => {
    const url = adminDatabaseUrl ?? '';
    adminDataSource = new DataSource({ type: 'postgres', url });
    await adminDataSource.initialize();
    // CREATE DATABASE cannot run inside a transaction block; DataSource#query
    // issues it as a standalone statement, which is what we need here.
    await adminDataSource.query(`CREATE DATABASE "${databaseName}"`);

    const testDatabaseUrl = withDatabaseName(url, databaseName);

    // Build the schema from the REAL migration chain (never hand-written
    // DDL) so this suite validates the raw SQL in BackupRepository/
    // BackupLeaseRepository against the exact column types production has —
    // enum-typed `status`/`category`, varchar `connectionId`, NOT NULL
    // constraints, etc. The glob picks up every migration file, so a future
    // migration is automatically included without touching this test.
    const migrationsDataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      migrations: [join(__dirname, '../../database/migrations/*{.ts,.js}')],
    });
    await migrationsDataSource.initialize();
    await migrationsDataSource.runMigrations();
    await migrationsDataSource.destroy();

    firstDataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      entities: [BackupJobEntity],
    });
    secondDataSource = new DataSource({
      type: 'postgres',
      url: testDatabaseUrl,
      entities: [BackupJobEntity],
    });
    await firstDataSource.initialize();
    await secondDataSource.initialize();

    firstRepository = new BackupLeaseRepository(firstDataSource);
    secondRepository = new BackupLeaseRepository(secondDataSource);
    firstBackupRepository = new BackupRepository(
      firstDataSource.getRepository(BackupJobEntity),
      firstDataSource,
    );
    secondBackupRepository = new BackupRepository(
      secondDataSource.getRepository(BackupJobEntity),
      secondDataSource,
    );
  });

  beforeEach(async () => {
    await firstDataSource.query('DELETE FROM backup_leases');
    await firstDataSource.query('DELETE FROM backup_jobs');
  });

  afterAll(async () => {
    try {
      if (secondDataSource?.isInitialized) await secondDataSource.destroy();
      if (firstDataSource?.isInitialized) await firstDataSource.destroy();
    } finally {
      if (adminDataSource?.isInitialized) {
        await adminDataSource.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await adminDataSource.destroy();
      }
    }
  });

  async function insertBackupJob(
    id: string,
    jobConnectionId: string,
    status: JobStatus.PENDING | JobStatus.RUNNING,
  ): Promise<void> {
    // "environment" and "triggeredBy" are NOT NULL in the real schema (no
    // default for environment), unlike the hand-written table this suite
    // used to create.
    await firstDataSource.query(
      `INSERT INTO backup_jobs (id, "connectionId", environment, status, "fileKey", "triggeredBy")
       VALUES ($1, $2, $3, $4, 'conn/manual/fencing.dump', 'fencing-test')`,
      [id, jobConnectionId, Environment.PROD, status],
    );
  }

  it('allows exactly one concurrent connection lease winner', async () => {
    const results = await Promise.all([
      firstRepository.tryAcquire(
        connectionId,
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000201',
        300_000,
      ),
      secondRepository.tryAcquire(
        connectionId,
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-000000000202',
        300_000,
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('takes over an expired lease and rejects the previous owner via token-scoped renew/release', async () => {
    const firstJob = '00000000-0000-0000-0000-000000000101';
    const firstToken = '00000000-0000-0000-0000-000000000201';
    const secondJob = '00000000-0000-0000-0000-000000000102';
    const secondToken = '00000000-0000-0000-0000-000000000202';

    expect(await firstRepository.tryAcquire(connectionId, firstJob, firstToken, -1_000)).toBe(true);
    expect(await secondRepository.tryAcquire(connectionId, secondJob, secondToken, 60_000)).toBe(true);
    expect(await firstRepository.renew(connectionId, firstJob, firstToken, 60_000)).toBe(false);
    expect(await firstRepository.release(connectionId, firstJob, firstToken)).toBe(false);
    expect(await secondRepository.renew(connectionId, secondJob, secondToken, 60_000)).toBe(true);
    expect(await secondRepository.release(connectionId, secondJob, secondToken)).toBe(true);
  });

  it('does not let two replicas hold a live lease on the same connection at once', async () => {
    const firstJob = '00000000-0000-0000-0000-000000000103';
    const firstToken = '00000000-0000-0000-0000-000000000203';
    const secondJob = '00000000-0000-0000-0000-000000000104';
    const secondToken = '00000000-0000-0000-0000-000000000204';

    expect(await firstRepository.tryAcquire(connectionId, firstJob, firstToken, 60_000)).toBe(true);
    expect(await secondRepository.tryAcquire(connectionId, secondJob, secondToken, 60_000)).toBe(false);

    const rows = await firstDataSource.query<{ backupJobId: string }[]>(
      'SELECT "backupJobId" FROM backup_leases WHERE "connectionId" = $1',
      [connectionId],
    );
    expect(rows).toEqual([{ backupJobId: firstJob }]);
  });

  it('fences out a stale lease holder from writing FAILED once another replica takes over the lease', async () => {
    const jobId = '00000000-0000-0000-0000-000000000105';
    const staleToken = '00000000-0000-0000-0000-000000000205';
    const newOwnerToken = '00000000-0000-0000-0000-000000000206';

    await insertBackupJob(jobId, connectionId, JobStatus.RUNNING);

    expect(await firstRepository.tryAcquire(connectionId, jobId, staleToken, -1_000)).toBe(true);
    expect(await secondRepository.tryAcquire(connectionId, jobId, newOwnerToken, 60_000)).toBe(true);

    expect(
      await firstBackupRepository.failIfLeaseHeld(
        jobId,
        connectionId,
        staleToken,
        'stale replica failure',
        new Date(),
      ),
    ).toBe(false);

    const [stillRunning] = await firstDataSource.query<{ status: string; errorMessage: string | null }[]>(
      'SELECT status, "errorMessage" FROM backup_jobs WHERE id = $1',
      [jobId],
    );
    expect(stillRunning).toEqual({ status: JobStatus.RUNNING, errorMessage: null });

    expect(
      await secondBackupRepository.failIfLeaseHeld(
        jobId,
        connectionId,
        newOwnerToken,
        'current owner failure',
        new Date(),
      ),
    ).toBe(true);

    const [failed] = await firstDataSource.query<{ status: string; errorMessage: string | null }[]>(
      'SELECT status, "errorMessage" FROM backup_jobs WHERE id = $1',
      [jobId],
    );
    expect(failed).toEqual({ status: JobStatus.FAILED, errorMessage: 'current owner failure' });
  });

  it('fences out a stale lease holder from writing COMPLETED once another replica takes over the lease', async () => {
    const jobId = '00000000-0000-0000-0000-000000000106';
    const staleToken = '00000000-0000-0000-0000-000000000207';
    const newOwnerToken = '00000000-0000-0000-0000-000000000208';

    await insertBackupJob(jobId, connectionId, JobStatus.RUNNING);

    expect(await firstRepository.tryAcquire(connectionId, jobId, staleToken, -1_000)).toBe(true);
    expect(await secondRepository.tryAcquire(connectionId, jobId, newOwnerToken, 60_000)).toBe(true);

    expect(
      await firstBackupRepository.completeIfLeaseHeld(jobId, connectionId, staleToken, {
        fileSizeMb: 1,
        sha256: 'stale-sha',
        bytes: 100,
        completedAt: new Date(),
      }),
    ).toBe(false);

    const [stillRunning] = await firstDataSource.query<{ status: string }[]>(
      'SELECT status FROM backup_jobs WHERE id = $1',
      [jobId],
    );
    expect(stillRunning?.status).toBe(JobStatus.RUNNING);
  });

  it('allows the current lease holder to record the terminal outcome it still owns', async () => {
    const jobId = '00000000-0000-0000-0000-000000000107';
    const token = '00000000-0000-0000-0000-000000000209';

    await insertBackupJob(jobId, connectionId, JobStatus.PENDING);
    expect(await firstRepository.tryAcquire(connectionId, jobId, token, 60_000)).toBe(true);

    expect(
      await firstBackupRepository.completeIfLeaseHeld(jobId, connectionId, token, {
        fileSizeMb: 2.5,
        sha256: 'owned-sha',
        bytes: 200,
        completedAt: new Date(),
      }),
    ).toBe(true);

    const [completed] = await firstDataSource.query<{ status: string; sha256: string }[]>(
      'SELECT status, sha256 FROM backup_jobs WHERE id = $1',
      [jobId],
    );
    expect(completed).toEqual({ status: JobStatus.COMPLETED, sha256: 'owned-sha' });
  });

  describe('category-aware atomic coalescing', () => {
    it('coalesces two concurrent same-category enqueue requests for the same connection into one PENDING row', async () => {
      const connId = '00000000-0000-0000-0000-000000000401';
      const base = {
        connectionId: connId,
        environment: Environment.PROD,
        dbType: DbTypeEnum.POSTGRES,
        storageKeyVersion: STORAGE_KEY_VERSION.NEW,
        triggeredBy: 'race-test',
      };

      const [a, b] = await Promise.all([
        firstBackupRepository.insertPendingOrFindExisting({
          ...base,
          fileKey: 'a.dump',
          category: BackupCategory.HOURLY,
        }),
        secondBackupRepository.insertPendingOrFindExisting({
          ...base,
          fileKey: 'b.dump',
          category: BackupCategory.HOURLY,
        }),
      ]);

      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
      expect(a.job.id).toBe(b.job.id);

      const rows = await firstDataSource.query<{ id: string }[]>(
        `SELECT id FROM backup_jobs WHERE "connectionId" = $1 AND category = $2 AND status = 'pending'`,
        [connId, BackupCategory.HOURLY],
      );
      expect(rows).toHaveLength(1);
    });

    it('creates a separate PENDING row for a different category on the same connection', async () => {
      const connId = '00000000-0000-0000-0000-000000000402';
      const base = {
        connectionId: connId,
        environment: Environment.PROD,
        dbType: DbTypeEnum.POSTGRES,
        storageKeyVersion: STORAGE_KEY_VERSION.NEW,
        triggeredBy: 'category-test',
      };

      const hourly = await firstBackupRepository.insertPendingOrFindExisting({
        ...base,
        fileKey: 'hourly.dump',
        category: BackupCategory.HOURLY,
      });
      const daily = await firstBackupRepository.insertPendingOrFindExisting({
        ...base,
        fileKey: 'daily.dump',
        category: BackupCategory.DAILY,
      });

      expect(hourly.created).toBe(true);
      expect(daily.created).toBe(true);
      expect(hourly.job.id).not.toBe(daily.job.id);
    });
  });

  describe('migration 1778716800022 dedupe', () => {
    it('keeps the oldest PENDING row, fails the rest, and (re)creates the unique index', async () => {
      const runner = firstDataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.query('DROP INDEX IF EXISTS "UQ_backup_jobs_pending_connection_category"');

        const connId = '00000000-0000-0000-0000-000000000403';
        const olderId = '00000000-0000-0000-0000-000000000501';
        const newerId = '00000000-0000-0000-0000-000000000502';
        await firstDataSource.query(
          `INSERT INTO backup_jobs (id, "connectionId", environment, status, category, "fileKey", "triggeredBy", "createdAt")
           VALUES ($1, $2, $3, 'pending', $4, 'older.dump', 'dedupe-test', now() - interval '1 hour')`,
          [olderId, connId, Environment.PROD, BackupCategory.HOURLY],
        );
        await firstDataSource.query(
          `INSERT INTO backup_jobs (id, "connectionId", environment, status, category, "fileKey", "triggeredBy", "createdAt")
           VALUES ($1, $2, $3, 'pending', $4, 'newer.dump', 'dedupe-test', now())`,
          [newerId, connId, Environment.PROD, BackupCategory.HOURLY],
        );

        await pendingUniqueMigration.up(runner);

        const rows = await firstDataSource.query<
          { id: string; status: string; errorMessage: string | null }[]
        >(
          'SELECT id, status, "errorMessage" FROM backup_jobs WHERE "connectionId" = $1 ORDER BY "createdAt"',
          [connId],
        );
        expect(rows).toEqual([
          { id: olderId, status: JobStatus.PENDING, errorMessage: null },
          {
            id: newerId,
            status: JobStatus.FAILED,
            errorMessage: expect.stringContaining('Duplicate pending backup'),
          },
        ]);

        // The index must be usable again: a third concurrent PENDING row for
        // the same connection+category now coalesces instead of inserting.
        const result = await firstBackupRepository.insertPendingOrFindExisting({
          connectionId: connId,
          environment: Environment.PROD,
          dbType: DbTypeEnum.POSTGRES,
          storageKeyVersion: STORAGE_KEY_VERSION.NEW,
          fileKey: 'third.dump',
          category: BackupCategory.HOURLY,
          triggeredBy: 'dedupe-test',
        });
        expect(result.created).toBe(false);
        expect(result.job.id).toBe(olderId);
      } finally {
        await runner.release();
      }
    });
  });
});
