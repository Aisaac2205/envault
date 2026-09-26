import { DataSource } from 'typeorm';
import { CreateBackupLeases1778716800021 } from '../../database/migrations/1778716800021-create-backup-leases';
import { BackupLeaseRepository } from './backup-lease.repository';

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
    entities: [],
  });
  const secondDataSource = new DataSource({
    type: 'postgres',
    url: testDatabaseUrl,
    entities: [],
  });
  let firstRepository: BackupLeaseRepository;
  let secondRepository: BackupLeaseRepository;
  const migration = new CreateBackupLeases1778716800021();
  const connectionId = '00000000-0000-0000-0000-000000000301';

  beforeAll(async () => {
    await firstDataSource.initialize();
    await secondDataSource.initialize();
    const runner = firstDataSource.createQueryRunner();
    await runner.connect();
    try {
      const [leases] = await runner.query("SELECT to_regclass('public.backup_leases') AS name");
      if (leases.name) {
        throw new Error('Backup lease integration test requires an empty local test database');
      }
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    firstRepository = new BackupLeaseRepository(firstDataSource);
    secondRepository = new BackupLeaseRepository(secondDataSource);
  });

  beforeEach(async () => {
    await firstDataSource.query('DELETE FROM backup_leases');
  });

  afterAll(async () => {
    try {
      if (firstDataSource.isInitialized) {
        const runner = firstDataSource.createQueryRunner();
        await runner.connect();
        try {
          await migration.down(runner);
        } finally {
          await runner.release();
        }
      }
    } finally {
      if (secondDataSource.isInitialized) await secondDataSource.destroy();
      if (firstDataSource.isInitialized) await firstDataSource.destroy();
    }
  });

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
});
