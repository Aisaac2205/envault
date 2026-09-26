import { DataSource } from 'typeorm';
import { CreateBackupLeases1778716800021 } from '../../database/migrations/1778716800021-create-backup-leases';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { JobStatus } from '../../database/enums/job-status.enum';
import { BackupLeaseRepository } from './backup-lease.repository';
import { BackupRepository } from './backup.repository';

function resolveTestDatabaseUrl(): string | null {
  const value = process.env.BACKUP_LEASE_TEST_DATABASE_URL;
  if (!value) return null;

  const url = new URL(value);
  const isTestDatabase =
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname === 'localhost' &&
    url.port === '5434' &&
    url.pathname === '/testdb' &&
    url.username === 'test_user';

  if (!isTestDatabase) {
    throw new Error('BACKUP_LEASE_TEST_DATABASE_URL must target the local test database');
  }

  return value;
}

const databaseUrl = resolveTestDatabaseUrl();
const integration = databaseUrl ? describe : describe.skip;
const testDatabaseUrl = databaseUrl ?? '';

integration('backup lease PostgreSQL integration', () => {
  const firstDataSource = new DataSource({
    type: 'postgres',
    url: testDatabaseUrl,
    entities: [BackupJobEntity],
  });
  const secondDataSource = new DataSource({
    type: 'postgres',
    url: testDatabaseUrl,
    entities: [BackupJobEntity],
  });
  let firstRepository: BackupLeaseRepository;
  let secondRepository: BackupLeaseRepository;
  let firstBackupRepository: BackupRepository;
  let secondBackupRepository: BackupRepository;
  const migration = new CreateBackupLeases1778716800021();
  const connectionId = '00000000-0000-0000-0000-000000000301';
  let createdBackupJobs = false;

  beforeAll(async () => {
    await firstDataSource.initialize();
    await secondDataSource.initialize();
    const runner = firstDataSource.createQueryRunner();
    await runner.connect();
    try {
      const [leases] = await runner.query("SELECT to_regclass('public.backup_leases') AS name");
      const [jobs] = await runner.query("SELECT to_regclass('public.backup_jobs') AS name");
      if (leases.name || jobs.name) {
        throw new Error('Backup lease integration test requires an empty local test database');
      }
      await runner.query(`CREATE TABLE backup_jobs (
        id uuid PRIMARY KEY,
        "connectionId" uuid NOT NULL,
        status varchar NOT NULL,
        "fileKey" varchar NULL,
        "fileSizeMb" float NULL,
        sha256 varchar NULL,
        bytes bigint NULL,
        "startedAt" timestamp NULL,
        "completedAt" timestamp NULL,
        "errorMessage" text NULL,
        "triggeredBy" varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
      createdBackupJobs = true;
      await migration.up(runner);
    } finally {
      await runner.release();
    }
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
      if (firstDataSource.isInitialized) {
        const runner = firstDataSource.createQueryRunner();
        await runner.connect();
        try {
          await migration.down(runner);
          if (createdBackupJobs) await runner.query('DROP TABLE backup_jobs');
        } finally {
          await runner.release();
        }
      }
    } finally {
      if (secondDataSource.isInitialized) await secondDataSource.destroy();
      if (firstDataSource.isInitialized) await firstDataSource.destroy();
    }
  });

  async function insertBackupJob(
    id: string,
    jobConnectionId: string,
    status: JobStatus.PENDING | JobStatus.RUNNING,
  ): Promise<void> {
    await firstDataSource.query(
      `INSERT INTO backup_jobs (id, "connectionId", status, "fileKey", "triggeredBy")
       VALUES ($1, $2, $3, 'conn/manual/fencing.dump', 'fencing-test')`,
      [id, jobConnectionId, status],
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
});
