import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { lstat, mkdtemp, rm, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { encrypt } from '../../common/utils/encryption';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { RestoreJobEntity } from '../../database/entities/restore-job.entity';
import { CreateRestoreLeases1778716800018 } from '../../database/migrations/1778716800018-create-restore-leases';
import { ConnectionsRepository } from '../connections/connections.repository';
import { ConnectionsService } from '../connections/connections.service';
import { BackupService } from '../backup/backup.service';
import { R2Service } from '../backup/r2.service';
import { RestoreStrategy } from '../backup/interfaces/restore-strategy.interface';
import { SseService } from '../../shared/sse/sse.service';
import { RestoreLeaseRepository } from './restore-lease.repository';
import { RestoreExecutionOwnershipService } from './restore-execution-ownership.service';
import { RestoreRepository } from './restore.repository';
import { RestoreService } from './restore.service';
import { RestoreStagingService } from './restore-staging.service';

function resolveTestDatabaseUrl(): string | null {
  const value = process.env.RESTORE_LEASE_TEST_DATABASE_URL;
  if (!value) return null;

  const url = new URL(value);
  const isTestDatabase =
    (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
    url.hostname === 'localhost' &&
    url.port === '5434' &&
    url.pathname === '/testdb' &&
    url.username === 'test_user';

  if (!isTestDatabase) {
    throw new Error('RESTORE_LEASE_TEST_DATABASE_URL must target the local test database');
  }

  return value;
}

const databaseUrl = resolveTestDatabaseUrl();
const integration = databaseUrl ? describe : describe.skip;
const testDatabaseUrl = databaseUrl ?? '';

integration('restore lease PostgreSQL integration', () => {
  const firstDataSource = new DataSource({
    type: 'postgres',
    url: testDatabaseUrl,
    entities: [ConnectionEntity, RestoreJobEntity],
  });
  const secondDataSource = new DataSource({
    type: 'postgres',
    url: testDatabaseUrl,
    entities: [ConnectionEntity, RestoreJobEntity],
  });
  let firstRepository: RestoreLeaseRepository;
  let secondRepository: RestoreLeaseRepository;
  let firstRestoreRepository: RestoreRepository;
  let secondRestoreRepository: RestoreRepository;
  let firstOwnershipService: RestoreExecutionOwnershipService;
  let secondOwnershipService: RestoreExecutionOwnershipService;
  let secondRestoreService: RestoreService;
  let secondRestoreModule: TestingModule;
  let strategyExecutions = 0;
  const migration = new CreateRestoreLeases1778716800018();
  const target = '00000000-0000-0000-0000-000000000001';
  const targetTwo = '00000000-0000-0000-0000-000000000002';
  let createdRestoreJobs = false;
  let createdConnections = false;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    await firstDataSource.initialize();
    await secondDataSource.initialize();
    const runner = firstDataSource.createQueryRunner();
    await runner.connect();
    try {
      const [restoreJobs] = await runner.query("SELECT to_regclass('public.restore_jobs') AS name");
      const [connections] = await runner.query("SELECT to_regclass('public.connections') AS name");
      const [leases] = await runner.query("SELECT to_regclass('public.restore_leases') AS name");
      if (restoreJobs.name || connections.name || leases.name) {
        throw new Error('Restore queue integration test requires an empty local test database');
      }
      await runner.query(`CREATE TABLE restore_jobs (
        id uuid PRIMARY KEY,
        "sourceBackupId" varchar NULL,
        "r2Key" varchar NULL,
        "targetConnectionId" varchar NOT NULL,
        "targetEnvironment" varchar NOT NULL,
        status varchar NOT NULL,
        "isDryRun" boolean NOT NULL,
        "startedAt" timestamp NOT NULL,
        "completedAt" timestamp NULL,
        "errorMessage" text NULL,
        "triggeredBy" varchar NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now()
      )`);
      createdRestoreJobs = true;
      await runner.query(`CREATE TABLE connections (
        id uuid PRIMARY KEY,
        name varchar NOT NULL,
        slug varchar NOT NULL,
        environment varchar NOT NULL,
        "dbType" varchar NOT NULL,
        host varchar NOT NULL,
        port integer NOT NULL,
        database varchar NOT NULL,
        username varchar NOT NULL,
        password varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )`);
      createdConnections = true;
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    firstRepository = new RestoreLeaseRepository(firstDataSource);
    secondRepository = new RestoreLeaseRepository(secondDataSource);
    firstRestoreRepository = new RestoreRepository(
      firstDataSource.getRepository(RestoreJobEntity),
      firstDataSource,
    );
    secondRestoreRepository = new RestoreRepository(
      secondDataSource.getRepository(RestoreJobEntity),
      secondDataSource,
    );
    firstOwnershipService = new RestoreExecutionOwnershipService(firstDataSource);
    secondOwnershipService = new RestoreExecutionOwnershipService(secondDataSource);
    secondRestoreModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: secondRestoreRepository },
        { provide: RestoreLeaseRepository, useValue: secondRepository },
        {
          provide: RestoreExecutionOwnershipService,
          useValue: secondOwnershipService,
        },
        { provide: R2Service, useValue: {} },
        { provide: BackupService, useValue: {} },
        { provide: ConnectionsService, useValue: {} },
        {
          provide: RestoreStagingService,
          useValue: {
            cleanup: async () => undefined,
            create: async () => { throw new Error('Unexpected restore staging creation'); },
            sweepOrphans: async () => undefined,
            writeDump: async () => { throw new Error('Unexpected restore staging write'); },
          },
        },
        {
          provide: SseService,
          useValue: { complete: () => undefined, emit: () => undefined },
        },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([
            [DbTypeEnum.POSTGRES, { execute: async () => { strategyExecutions += 1; } }],
          ]),
        },
      ],
    }).compile();
    secondRestoreService = secondRestoreModule.get(RestoreService);
  });

  beforeEach(async () => {
    strategyExecutions = 0;
    await firstDataSource.query('DELETE FROM restore_leases');
    await firstDataSource.query('DELETE FROM restore_jobs');
    await firstDataSource.query('DELETE FROM connections');
  });

  async function insertRestoreJob(
    id: string,
    targetConnectionId: string,
    status: JobStatus.PENDING | JobStatus.RUNNING,
  ): Promise<void> {
    await firstDataSource.query(
      `INSERT INTO restore_jobs (id, "targetConnectionId", "targetEnvironment", status, "isDryRun", "startedAt", "triggeredBy")
       VALUES ($1, $2, 'dev', $3, FALSE, CURRENT_TIMESTAMP, 'recovery-test')`,
      [id, targetConnectionId, status],
    );
  }

  afterAll(async () => {
    try {
      if (firstDataSource.isInitialized) {
        const runner = firstDataSource.createQueryRunner();
        await runner.connect();
        try {
          await migration.down(runner);
          if (createdConnections) await runner.query('DROP TABLE connections');
          if (createdRestoreJobs) await runner.query('DROP TABLE restore_jobs');
        } finally {
          await runner.release();
        }
      }
    } finally {
      await secondRestoreModule.close();
      if (secondDataSource.isInitialized) await secondDataSource.destroy();
      if (firstDataSource.isInitialized) await firstDataSource.destroy();
    }
  });

  it('allows exactly one concurrent target lease winner', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const results = await Promise.all([
      firstRepository.tryAcquire(target, '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201', expiresAt),
      secondRepository.tryAcquire(target, '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000202', expiresAt),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('takes over expired leases and rejects the previous owner', async () => {
    const firstJob = '00000000-0000-0000-0000-000000000101';
    const firstToken = '00000000-0000-0000-0000-000000000201';
    const secondJob = '00000000-0000-0000-0000-000000000102';
    const secondToken = '00000000-0000-0000-0000-000000000202';
    const expiresAt = new Date(Date.now() + 60_000);

    expect(await firstRepository.tryAcquire(target, firstJob, firstToken, new Date(Date.now() - 1_000))).toBe(true);
    expect(await secondRepository.tryAcquire(target, secondJob, secondToken, expiresAt)).toBe(true);
    expect(await firstRepository.renew(target, firstJob, firstToken, expiresAt)).toBe(false);
    expect(await firstRepository.release(target, firstJob, firstToken)).toBe(false);
    expect(await secondRepository.renew(target, secondJob, secondToken, expiresAt)).toBe(true);
    expect(await secondRepository.release(target, secondJob, secondToken)).toBe(true);
  });

  it('keeps target execution exclusive after an expired lease is taken over', async () => {
    const firstOwnership = await firstOwnershipService.tryAcquire(target);
    expect(firstOwnership).not.toBeNull();
    if (!firstOwnership) throw new Error('first ownership was not acquired');

    const firstJob = '00000000-0000-0000-0000-000000000111';
    const firstToken = '00000000-0000-0000-0000-000000000211';
    const secondJob = '00000000-0000-0000-0000-000000000112';
    const secondToken = '00000000-0000-0000-0000-000000000212';

    try {
      expect(await firstRepository.tryAcquire(target, firstJob, firstToken, new Date(Date.now() - 1_000))).toBe(true);
      expect(await secondRepository.tryAcquire(target, secondJob, secondToken, new Date(Date.now() + 60_000))).toBe(true);
      expect(await firstOwnershipService.hasActiveLease(firstOwnership, firstJob, firstToken)).toBe(false);
      expect(await secondOwnershipService.tryAcquire(target)).toBeNull();
    } finally {
      await firstOwnershipService.release(firstOwnership);
    }

    const secondOwnership = await secondOwnershipService.tryAcquire(target);
    expect(secondOwnership).not.toBeNull();
    if (!secondOwnership) throw new Error('second ownership was not acquired');
    await secondOwnershipService.release(secondOwnership);
  });

  it('does not sweep old staging while another replica holds execution ownership', async () => {
    const stagingRoot = await mkdtemp(join(tmpdir(), 'vaultly-restore-staging-integration-'));
    const stagingService = new RestoreStagingService(secondOwnershipService, stagingRoot);
    const staging = await stagingService.create(
      '00000000-0000-0000-0000-000000000111',
      target,
    );
    if (!staging.dumpFileHandle) throw new Error('staging dump file was not opened');
    await staging.dumpFileHandle.close();
    staging.dumpFileHandle = null;
    const old = new Date(Date.now() - 3_600_001);
    await utimes(staging.directoryPath, old, old);
    const ownership = await firstOwnershipService.tryAcquire(target);
    expect(ownership).not.toBeNull();
    if (!ownership) throw new Error('first ownership was not acquired');

    try {
      await stagingService.sweepOrphans();
      expect((await lstat(staging.directoryPath)).isDirectory()).toBe(true);
    } finally {
      await firstOwnershipService.release(ownership);
    }

    await stagingService.sweepOrphans();
    await expect(lstat(staging.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(stagingRoot, { recursive: true, force: true });
  });

  it('admits exactly one concurrent restore job and target lease', async () => {
    const startedAt = new Date();
    const expiresAt = new Date(Date.now() + 60_000);
    await firstDataSource.query(
      `INSERT INTO connections (id, name, slug, environment, "dbType", host, port, database, username, password)
       VALUES ($1, 'Target', 'target-one', 'dev', 'postgres', 'localhost', 5432, 'target', 'user', $2)`,
      [target, encrypt('secret')],
    );
    const results = await Promise.all([
      firstRestoreRepository.tryCreateWithLease({
        id: '00000000-0000-0000-0000-000000000101',
        sourceBackupId: null,
        r2Key: 'source/manual/first.dump',
        targetConnectionId: target,
        targetEnvironment: Environment.DEV,
        triggeredBy: 'user-1',
        startedAt,
        leaseToken: '00000000-0000-0000-0000-000000000201',
        expiresAt,
      }),
      secondRestoreRepository.tryCreateWithLease({
        id: '00000000-0000-0000-0000-000000000102',
        sourceBackupId: null,
        r2Key: 'source/manual/second.dump',
        targetConnectionId: target,
        targetEnvironment: Environment.DEV,
        triggeredBy: 'user-2',
        startedAt,
        leaseToken: '00000000-0000-0000-0000-000000000202',
        expiresAt,
      }),
    ]);

    expect(results.filter((jobId) => jobId !== null)).toHaveLength(1);
    expect(await firstDataSource.query('SELECT id FROM restore_jobs')).toHaveLength(1);
    expect(await firstDataSource.query('SELECT "restoreJobId" FROM restore_leases')).toHaveLength(1);
  });

  it('serializes restore admission and target production mutation', async () => {
    await firstDataSource.query(
      `INSERT INTO connections (id, name, slug, environment, "dbType", host, port, database, username, password)
       VALUES ($1, 'Target', 'target-two', 'dev', 'postgres', 'localhost', 5432, 'target', 'user', $2)`,
      [targetTwo, encrypt('secret')],
    );
    const secondConnectionsService = new ConnectionsService(
      new ConnectionsRepository(
        secondDataSource.getRepository(ConnectionEntity),
        secondDataSource,
      ),
    );
    const [admission, mutation] = await Promise.allSettled([
      firstRestoreRepository.tryCreateWithLease({
        id: '00000000-0000-0000-0000-000000000103',
        sourceBackupId: null,
        r2Key: 'source/manual/race.dump',
        targetConnectionId: targetTwo,
        targetEnvironment: Environment.DEV,
        triggeredBy: 'user-3',
        startedAt: new Date(),
        leaseToken: '00000000-0000-0000-0000-000000000203',
        expiresAt: new Date(Date.now() + 60_000),
      }),
      secondConnectionsService.update(targetTwo, {
        environment: Environment.PROD,
      }),
    ]);
    const targetRow = await firstDataSource.query<{ environment: Environment }[]>(
      'SELECT environment FROM connections WHERE id = $1',
      [targetTwo],
    );

    if (admission.status === 'fulfilled' && admission.value !== null) {
      expect(mutation.status).toBe('rejected');
      if (mutation.status === 'rejected') {
        expect(mutation.reason).toBeInstanceOf(ForbiddenException);
      }
      expect(targetRow[0]?.environment).toBe(Environment.DEV);
      expect(await firstDataSource.query('SELECT id FROM restore_jobs')).toHaveLength(1);
      expect(await firstDataSource.query('SELECT "restoreJobId" FROM restore_leases')).toHaveLength(1);
      return;
    }

    expect(admission).toEqual({ status: 'fulfilled', value: null });
    expect(mutation.status).toBe('fulfilled');
    expect(targetRow[0]?.environment).toBe(Environment.PROD);
    expect(await firstDataSource.query('SELECT id FROM restore_jobs')).toHaveLength(0);
    expect(await firstDataSource.query('SELECT "restoreJobId" FROM restore_leases')).toHaveLength(0);
  });

  it('rejects a missing or inactive target during the live preflight session', async () => {
    const ownership = await firstOwnershipService.tryAcquire(target);
    expect(ownership).not.toBeNull();
    if (!ownership) throw new Error('ownership was not acquired');

    try {
      expect(await firstOwnershipService.findActiveTarget(ownership)).toBeNull();
    } finally {
      await firstOwnershipService.release(ownership);
    }
  });

  it('recovers only abandoned jobs through the second replica bootstrap lifecycle', async () => {
    const liveJobId = '00000000-0000-0000-0000-000000000121';
    const pendingJobId = '00000000-0000-0000-0000-000000000122';
    const runningJobId = '00000000-0000-0000-0000-000000000123';
    const expiredAt = new Date(Date.now() - 1_000);
    await insertRestoreJob(liveJobId, target, JobStatus.RUNNING);
    await insertRestoreJob(pendingJobId, targetTwo, JobStatus.PENDING);
    await insertRestoreJob(runningJobId, targetTwo, JobStatus.RUNNING);
    expect(await firstRepository.tryAcquire(
      target,
      liveJobId,
      '00000000-0000-0000-0000-000000000221',
      expiredAt,
    )).toBe(true);
    expect(await firstRepository.tryAcquire(
      targetTwo,
      pendingJobId,
      '00000000-0000-0000-0000-000000000222',
      expiredAt,
    )).toBe(true);
    const owner = await firstOwnershipService.tryAcquire(target);
    expect(owner).not.toBeNull();
    if (!owner) throw new Error('first ownership was not acquired');

    try {
      await secondRestoreService.onApplicationBootstrap();
    } finally {
      await firstOwnershipService.release(owner);
    }

    const jobs = await firstDataSource.query<{ id: string; status: string; errorMessage: string | null }[]>(
      'SELECT id, status, "errorMessage" FROM restore_jobs ORDER BY id',
    );
    expect(jobs).toEqual([
      { id: liveJobId, status: JobStatus.RUNNING, errorMessage: null },
      { id: pendingJobId, status: JobStatus.FAILED, errorMessage: 'Job interrupted — process restarted' },
      { id: runningJobId, status: JobStatus.FAILED, errorMessage: 'Job interrupted — process restarted' },
    ]);
    const leases = await firstDataSource.query<{ targetConnectionId: string }[]>(
      'SELECT "targetConnectionId" FROM restore_leases ORDER BY "targetConnectionId"',
    );
    expect(leases).toEqual([{ targetConnectionId: target }]);
  });

  it('terminalizes a delayed stale callback without touching its successor lease', async () => {
    const staleJobId = '00000000-0000-0000-0000-000000000124';
    const staleToken = '00000000-0000-0000-0000-000000000224';
    const successorJobId = '00000000-0000-0000-0000-000000000125';
    const successorToken = '00000000-0000-0000-0000-000000000225';
    await insertRestoreJob(staleJobId, target, JobStatus.PENDING);
    expect(await firstRepository.tryAcquire(
      target,
      staleJobId,
      staleToken,
      new Date(Date.now() - 1_000),
    )).toBe(true);
    await insertRestoreJob(successorJobId, target, JobStatus.PENDING);
    expect(await secondRepository.tryAcquire(
      target,
      successorJobId,
      successorToken,
      new Date(Date.now() + 60_000),
    )).toBe(true);

    await secondRestoreService.executeRestoreAsync(
      staleJobId,
      { targetConnectionId: target, isDryRun: false, r2Key: 'source/manual/stale.dump' },
      { id: 'recovery-test', email: 'recovery@example.test', name: 'Recovery', role: 'admin' },
      staleToken,
    );

    const [stale] = await firstDataSource.query<{ status: string; errorMessage: string }[]>(
      'SELECT status, "errorMessage" FROM restore_jobs WHERE id = $1',
      [staleJobId],
    );
    const [successor] = await firstDataSource.query<{ status: string }[]>(
      'SELECT status FROM restore_jobs WHERE id = $1',
      [successorJobId],
    );
    const [lease] = await firstDataSource.query<{ restoreJobId: string; leaseToken: string }[]>(
      'SELECT "restoreJobId", "leaseToken" FROM restore_leases WHERE "targetConnectionId" = $1',
      [target],
    );
    expect(stale).toEqual({ status: JobStatus.FAILED, errorMessage: 'Restore execution became stale before it started' });
    expect(successor?.status).toBe(JobStatus.PENDING);
    expect(lease).toEqual({ restoreJobId: successorJobId, leaseToken: successorToken });
    expect(strategyExecutions).toBe(0);
  });

  it('does not race a newly admitted worker or release its lease', async () => {
    const abandonedJobId = '00000000-0000-0000-0000-000000000125';
    const activeJobId = '00000000-0000-0000-0000-000000000126';
    const activeToken = '00000000-0000-0000-0000-000000000226';
    await insertRestoreJob(abandonedJobId, target, JobStatus.RUNNING);
    await firstRepository.tryAcquire(
      target,
      abandonedJobId,
      '00000000-0000-0000-0000-000000000225',
      new Date(Date.now() - 1_000),
    );
    await insertRestoreJob(activeJobId, target, JobStatus.PENDING);
    expect(await secondRepository.tryAcquire(
      target,
      activeJobId,
      activeToken,
      new Date(Date.now() + 60_000),
    )).toBe(true);

    const ownership = await firstOwnershipService.tryAcquire(target);
    expect(ownership).not.toBeNull();
    if (!ownership) throw new Error('recovery ownership was not acquired');
    try {
      expect(await firstRestoreRepository.recoverIfReclaimable(
        abandonedJobId,
        target,
        'Job interrupted — process restarted',
        new Date(),
      )).toBe(false);
    } finally {
      await firstOwnershipService.release(ownership);
    }

    const [abandoned] = await firstDataSource.query<{ status: string }[]>(
      'SELECT status FROM restore_jobs WHERE id = $1',
      [abandonedJobId],
    );
    const [lease] = await firstDataSource.query<{ restoreJobId: string; leaseToken: string }[]>(
      'SELECT "restoreJobId", "leaseToken" FROM restore_leases WHERE "targetConnectionId" = $1',
      [target],
    );
    expect(abandoned?.status).toBe(JobStatus.RUNNING);
    expect(lease).toEqual({ restoreJobId: activeJobId, leaseToken: activeToken });
  });
});
