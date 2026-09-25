import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { BackupService } from '../backup/backup.service';
import { R2Service } from '../backup/r2.service';
import { RestoreStrategy } from '../backup/interfaces/restore-strategy.interface';
import { ConnectionsService } from '../connections/connections.service';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { SseService } from '../../shared/sse/sse.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RestoreExecutionOwnershipService } from './restore-execution-ownership.service';
import { RestoreLeaseRepository } from './restore-lease.repository';
import { RestoreRepository } from './restore.repository';
import { RestoreService } from './restore.service';
import { RestoreStagingService } from './restore-staging.service';

type FinalizerStep = 'staging' | 'ownership' | 'sse' | 'lease';

describe('RestoreService finalizer', () => {
  const targetConnectionId = '00000000-0000-0000-0000-000000000001';
  const jobId = '00000000-0000-0000-0000-000000000002';
  const leaseToken = '00000000-0000-0000-0000-000000000003';

  async function createService(failingStep: FinalizerStep) {
    const calls: string[] = [];
    const restoreRepository = {
      failPendingIfLeaseInactive: jest.fn().mockResolvedValue(undefined),
      startIfLeaseActive: jest.fn().mockResolvedValue(true),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    const target = { dbType: DbTypeEnum.POSTGRES, environment: Environment.DEV };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: restoreRepository },
        {
          provide: RestoreLeaseRepository,
          useValue: {
            release: async () => {
              calls.push('lease');
              if (failingStep === 'lease') throw new Error('lease release failed');
            },
          },
        },
        {
          provide: RestoreExecutionOwnershipService,
          useValue: {
            findActiveTarget: async () => target,
            hasActiveLease: async () => true,
            release: async () => {
              calls.push('ownership');
              if (failingStep === 'ownership') throw new Error('ownership release failed');
            },
            tryAcquire: async () => ({ targetConnectionId }),
          },
        },
        {
          provide: RestoreStagingService,
          useValue: {
            cleanup: async () => {
              calls.push('staging');
              if (failingStep === 'staging') throw new Error('staging cleanup failed');
            },
            create: async () => ({ directoryPath: 'staging', dumpFileHandle: null, dumpFilePath: 'staging/dump', metadataPath: 'staging/metadata' }),
            writeDump: async () => ({
              sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              bytes: 1024,
            }),
          },
        },
        { provide: R2Service, useValue: { download: async () => Readable.from('dump'), downloadJson: async () => null } },
        {
          provide: BackupService,
          useValue: {
            getBackupById: async () => ({
              dbType: DbTypeEnum.POSTGRES,
              fileKey: 'source/manual/dump.dump',
              status: JobStatus.COMPLETED,
              sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            }),
          },
        },
        { provide: ConnectionsService, useValue: { findById: async () => target } },
        {
          provide: SseService,
          useValue: {
            complete: () => {
              calls.push('sse');
              if (failingStep === 'sse') throw new Error('sse completion failed');
            },
            emit: () => undefined,
          },
        },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([
            [DbTypeEnum.POSTGRES, { execute: async () => undefined }],
          ]),
        },
      ],
    }).compile();

    return { calls, restoreRepository, service: module.get(RestoreService) };
  }

  const finalizerSteps: FinalizerStep[] = ['staging', 'ownership', 'sse', 'lease'];

  for (const failingStep of finalizerSteps) {
    it(`releases the token-matched lease after a ${failingStep} finalizer failure`, async () => {
      const { calls, restoreRepository, service } = await createService(failingStep);

      await expect(service.executeRestoreAsync(
        jobId,
        { isDryRun: false, sourceBackupId: 'backup-1', targetConnectionId },
        { email: 'admin@example.test', id: 'admin', name: 'Admin', role: 'admin' },
        leaseToken,
      )).resolves.toBeUndefined();

      expect(calls).toEqual(['staging', 'ownership', 'sse', 'lease']);
      expect(restoreRepository.updateStatus).toHaveBeenCalledWith(
        jobId,
        JobStatus.COMPLETED,
        expect.objectContaining({ completedAt: expect.any(Date) }),
      );
    });
  }

  it('rejects restore with BadRequestException if actual sha256 does not match DB digest', async () => {
    const restoreRepository = {
      failPendingIfLeaseInactive: jest.fn().mockResolvedValue(undefined),
      startIfLeaseActive: jest.fn().mockResolvedValue(true),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    const target = { dbType: DbTypeEnum.POSTGRES, environment: Environment.DEV };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: restoreRepository },
        { provide: RestoreLeaseRepository, useValue: { release: async () => undefined } },
        {
          provide: RestoreExecutionOwnershipService,
          useValue: {
            findActiveTarget: async () => target,
            hasActiveLease: async () => true,
            release: async () => undefined,
            tryAcquire: async () => ({ targetConnectionId }),
          },
        },
        {
          provide: RestoreStagingService,
          useValue: {
            cleanup: async () => undefined,
            create: async () => ({ directoryPath: 'staging', dumpFileHandle: null, dumpFilePath: 'staging/dump', metadataPath: 'staging/metadata' }),
            writeDump: async () => ({
              sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              bytes: 1024,
            }),
          },
        },
        { provide: R2Service, useValue: { download: async () => Readable.from('dump'), downloadJson: async () => null } },
        {
          provide: BackupService,
          useValue: {
            getBackupById: async () => ({
              dbType: DbTypeEnum.POSTGRES,
              fileKey: 'source/manual/dump.dump',
              status: JobStatus.COMPLETED,
              sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            }),
          },
        },
        { provide: ConnectionsService, useValue: { findById: async () => target } },
        { provide: SseService, useValue: { complete: () => undefined, emit: () => undefined } },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([
            [DbTypeEnum.POSTGRES, { execute: async () => undefined }],
          ]),
        },
      ],
    }).compile();

    const service = module.get<RestoreService>(RestoreService);

    await expect(
      service.executeRestoreAsync(
        jobId,
        { isDryRun: false, sourceBackupId: 'backup-1', targetConnectionId },
        { email: 'admin@example.test', id: 'admin', name: 'Admin', role: 'admin' },
        leaseToken,
      ),
    ).resolves.toBeUndefined();

    expect(restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.FAILED,
      expect.objectContaining({
        errorMessage: expect.stringContaining('digest criptográfico'),
      }),
    );
  });

});

describe('RestoreService engine compatibility by sourceBackupId', () => {
  const targetConnectionId = '00000000-0000-0000-0000-000000000001';
  const testUser: AuthUser = {
    id: 'admin-user',
    email: 'admin@vaultly.local',
    name: 'Admin',
    role: 'admin',
  };

  async function buildModule({
    targetDbType = DbTypeEnum.POSTGRES,
    backupDbType = DbTypeEnum.POSTGRES,
    backupStatus = JobStatus.COMPLETED,
    backupFileKey = 'source/manual/dump.dump' as string | null,
    targetEnv = Environment.DEV,
  }: {
    targetDbType?: DbTypeEnum;
    backupDbType?: DbTypeEnum | null;
    backupStatus?: JobStatus;
    backupFileKey?: string | null;
    targetEnv?: Environment;
  } = {}) {
    const target = {
      id: targetConnectionId,
      name: 'Test Target',
      dbType: targetDbType,
      environment: targetEnv,
    };
    const backup = {
      id: 'backup-1',
      dbType: backupDbType,
      fileKey: backupFileKey,
      status: backupStatus,
    };

    const restoreRepository = {
      create: jest.fn().mockResolvedValue({ id: 'dry-job-1' }),
      tryCreateWithLease: jest.fn().mockResolvedValue('admitted-job-1'),
      startIfLeaseActive: jest.fn().mockResolvedValue(true),
      failPendingIfLeaseInactive: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    const connectionsService = {
      findById: jest.fn().mockResolvedValue(target),
    };

    const backupService = {
      getBackupById: jest.fn().mockResolvedValue(backup),
    };

    const sseService = {
      register: jest.fn(),
      emit: jest.fn(),
      complete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: restoreRepository },
        { provide: RestoreLeaseRepository, useValue: { release: jest.fn() } },
        {
          provide: RestoreExecutionOwnershipService,
          useValue: {
            findActiveTarget: jest.fn().mockResolvedValue(target),
            hasActiveLease: jest.fn().mockResolvedValue(true),
            release: jest.fn(),
            tryAcquire: jest.fn().mockResolvedValue({ targetConnectionId }),
          },
        },
        {
          provide: RestoreStagingService,
          useValue: {
            cleanup: jest.fn(),
            create: jest.fn().mockResolvedValue({
              directoryPath: 'staging',
              dumpFileHandle: null,
              dumpFilePath: 'staging/dump',
              metadataPath: 'staging/metadata',
            }),
            writeDump: jest.fn(),
          },
        },
        { provide: R2Service, useValue: { download: jest.fn().mockResolvedValue(Readable.from('dump')) } },
        { provide: BackupService, useValue: backupService },
        { provide: ConnectionsService, useValue: connectionsService },
        { provide: SseService, useValue: sseService },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([
            [DbTypeEnum.POSTGRES, { execute: jest.fn() }],
            [DbTypeEnum.MYSQL, { execute: jest.fn() }],
          ]),
        },
      ],
    }).compile();

    const service = module.get(RestoreService);
    jest.spyOn(service, 'executeRestoreAsync').mockResolvedValue(undefined);
    return { service, restoreRepository };
  }

  it('rejects restore when backup engine does not match target connection engine', async () => {
    const { service } = await buildModule({
      targetDbType: DbTypeEnum.POSTGRES,
      backupDbType: DbTypeEnum.MYSQL,
    });

    await expect(
      service.createRestore(
        {
          targetConnectionId,
          sourceBackupId: 'backup-1',
          isDryRun: false,
        },
        testUser,
      ),
    ).rejects.toThrow(
      new ForbiddenException(
        'Tipo de base de datos incompatible: el backup es "mysql" pero el destino "Test Target" es "postgres".',
      ),
    );
  });

  it('rejects restore when target engine is MySQL but backup engine is Postgres', async () => {
    const { service } = await buildModule({
      targetDbType: DbTypeEnum.MYSQL,
      backupDbType: DbTypeEnum.POSTGRES,
    });

    await expect(
      service.createRestore(
        {
          targetConnectionId,
          sourceBackupId: 'backup-1',
          isDryRun: false,
        },
        testUser,
      ),
    ).rejects.toThrow(
      new ForbiddenException(
        'Tipo de base de datos incompatible: el backup es "postgres" pero el destino "Test Target" es "mysql".',
      ),
    );
  });

  it('rejects dry run when backup engine does not match target connection engine', async () => {
    const { service } = await buildModule({
      targetDbType: DbTypeEnum.POSTGRES,
      backupDbType: DbTypeEnum.MYSQL,
    });

    await expect(
      service.createRestore(
        {
          targetConnectionId,
          sourceBackupId: 'backup-1',
          isDryRun: true,
        },
        testUser,
      ),
    ).rejects.toThrow(
      new ForbiddenException(
        'Tipo de base de datos incompatible: el backup es "mysql" pero el destino "Test Target" es "postgres".',
      ),
    );
  });

  it('rejects restore when backup job status is not completed', async () => {
    const { service } = await buildModule({
      targetDbType: DbTypeEnum.POSTGRES,
      backupDbType: DbTypeEnum.POSTGRES,
      backupStatus: JobStatus.FAILED,
    });

    await expect(
      service.createRestore(
        {
          targetConnectionId,
          sourceBackupId: 'backup-1',
          isDryRun: false,
        },
        testUser,
      ),
    ).rejects.toThrow(
      new ForbiddenException('El backup fuente no está completado o no tiene archivo.'),
    );
  });

  it('rejects restore when backup job has no fileKey', async () => {
    const { service } = await buildModule({
      targetDbType: DbTypeEnum.POSTGRES,
      backupDbType: DbTypeEnum.POSTGRES,
      backupFileKey: null,
    });

    await expect(
      service.createRestore(
        {
          targetConnectionId,
          sourceBackupId: 'backup-1',
          isDryRun: false,
        },
        testUser,
      ),
    ).rejects.toThrow(
      new ForbiddenException('El backup fuente no está completado o no tiene archivo.'),
    );
  });

  it('admits restore and returns jobId when engines match', async () => {
    const { service, restoreRepository } = await buildModule({
      targetDbType: DbTypeEnum.POSTGRES,
      backupDbType: DbTypeEnum.POSTGRES,
    });

    const result = await service.createRestore(
      {
        targetConnectionId,
        sourceBackupId: 'backup-1',
        isDryRun: false,
      },
      testUser,
    );

    expect(result).toEqual({ jobId: 'admitted-job-1' });
    expect(restoreRepository.tryCreateWithLease).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBackupId: 'backup-1',
        targetConnectionId,
      }),
    );
  });
});

describe('RestoreService executeRestoreAsync lease renewal heartbeat', () => {
  const targetConnectionId = '00000000-0000-0000-0000-000000000001';
  const jobId = '00000000-0000-0000-0000-000000000002';
  const leaseToken = '00000000-0000-0000-0000-000000000003';
  const testUser: AuthUser = {
    id: 'user-1',
    email: 'admin@envault.local',
    name: 'Admin',
    role: 'admin',
  };

  it('renews lease periodically during executeRestoreAsync and cleans up timer on finish', async () => {
    jest.useFakeTimers();

    const target = {
      id: targetConnectionId,
      name: 'Test Target',
      dbType: DbTypeEnum.POSTGRES,
      environment: Environment.DEV,
    };
    const renewMock = jest.fn().mockResolvedValue(true);
    const releaseMock = jest.fn().mockResolvedValue(true);

    const restoreRepository = {
      startIfLeaseActive: jest.fn().mockResolvedValue(true),
      failPendingIfLeaseInactive: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    let finishExecution: () => void = () => {};
    const executionPromise = new Promise<void>((resolve) => {
      finishExecution = resolve;
    });

    const strategyExecute = jest.fn().mockImplementation(() => executionPromise);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: restoreRepository },
        {
          provide: RestoreLeaseRepository,
          useValue: {
            renew: renewMock,
            release: releaseMock,
          },
        },
        {
          provide: RestoreExecutionOwnershipService,
          useValue: {
            tryAcquire: jest.fn().mockResolvedValue({ targetConnectionId }),
            release: jest.fn().mockResolvedValue(undefined),
            findActiveTarget: jest.fn().mockResolvedValue(target),
            hasActiveLease: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: RestoreStagingService,
          useValue: {
            create: jest.fn().mockResolvedValue({
              directoryPath: 'staging',
              dumpFilePath: 'staging/dump',
            }),
            writeDump: jest.fn().mockResolvedValue({ sha256: 'a'.repeat(64), bytes: 100 }),
            cleanup: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: R2Service,
          useValue: {
            download: jest.fn().mockResolvedValue(Readable.from('dump content')),
          },
        },
        {
          provide: BackupService,
          useValue: {
            getBackupById: jest.fn().mockResolvedValue({
              id: 'backup-1',
              fileKey: 'backups/test.dump',
              dbType: DbTypeEnum.POSTGRES,
              status: JobStatus.COMPLETED,
              sha256: 'a'.repeat(64),
            }),
          },
        },
        {
          provide: ConnectionsService,
          useValue: {
            findById: jest.fn().mockResolvedValue(target),
          },
        },
        {
          provide: SseService,
          useValue: {
            emit: jest.fn(),
            complete: jest.fn(),
          },
        },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([
            [DbTypeEnum.POSTGRES, { execute: strategyExecute }],
          ]),
        },
      ],
    }).compile();

    const service = module.get<RestoreService>(RestoreService);

    const promise = service.executeRestoreAsync(
      jobId,
      { targetConnectionId, sourceBackupId: 'backup-1', isDryRun: false },
      testUser,
      leaseToken,
    );

    expect(renewMock).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(renewMock).toHaveBeenCalledTimes(1);
    expect(renewMock).toHaveBeenCalledWith(
      targetConnectionId,
      jobId,
      leaseToken,
      expect.any(Date),
    );

    await jest.advanceTimersByTimeAsync(60_000);
    expect(renewMock).toHaveBeenCalledTimes(2);

    finishExecution();
    await promise;

    await jest.advanceTimersByTimeAsync(120_000);
    expect(renewMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledWith(targetConnectionId, jobId, leaseToken);

    jest.useRealTimers();
  });
});

