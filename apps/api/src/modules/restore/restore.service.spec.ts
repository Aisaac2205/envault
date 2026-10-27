import { BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Readable } from 'stream';
import { BackupService } from '../backup/backup.service';
import { R2Service } from '../backup/r2.service';
import { RestoreStrategy } from '../backup/interfaces/restore-strategy.interface';
import { RestoreRollbackError } from '../backup/strategies/mysql-schema-objects';
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
import { RESTORE_QUEUE_NAME } from './restore.constants';

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
    return { service, restoreRepository, backupService };
  }

  describe('a request that names no source backup', () => {
    // Without a source, getBackupById(undefined) used to be resolved by TypeORM as
    // a query without a where clause, i.e. the first backup row of the table.
    const noSource: Array<[string, Record<string, unknown>]> = [
      ['neither sourceBackupId nor r2Key', {}],
      ['undefined values', { sourceBackupId: undefined, r2Key: undefined }],
      ['empty strings', { sourceBackupId: '', r2Key: '' }],
    ];

    for (const isDryRun of [true, false]) {
      it.each(noSource)(
        `is refused with 400 before any backup lookup (%s, isDryRun: ${isDryRun})`,
        async (_title, source) => {
          const { service, restoreRepository, backupService } = await buildModule();

          await expect(
            service.createRestore({ targetConnectionId, isDryRun, ...source }, testUser),
          ).rejects.toBeInstanceOf(BadRequestException);

          expect(backupService.getBackupById).not.toHaveBeenCalled();
          expect(restoreRepository.create).not.toHaveBeenCalled();
          expect(restoreRepository.tryCreateWithLease).not.toHaveBeenCalled();
        },
      );
    }
  });

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

describe('RestoreService queue and cancelRestore', () => {
  const targetConnectionId = '00000000-0000-0000-0000-000000000001';
  const jobId = '00000000-0000-0000-0000-000000000002';
  const testUser: AuthUser = {
    id: 'user-1',
    email: 'admin@envault.dev',
    name: 'Admin',
    role: 'admin',
  };

  let mockRestoreRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    tryCreateWithLease: jest.Mock;
    updateStatus: jest.Mock;
    startIfLeaseActive: jest.Mock;
    failPendingIfLeaseInactive: jest.Mock;
  };
  let mockRestoreLeaseRepository: {
    release: jest.Mock;
    releaseByJobId: jest.Mock;
    renew: jest.Mock;
  };
  let mockQueue: {
    add: jest.Mock;
    getJob: jest.Mock;
  };
  let mockSseService: {
    register: jest.Mock;
    emit: jest.Mock;
    complete: jest.Mock;
  };
  let mockConnectionsService: {
    findById: jest.Mock;
  };
  let mockBackupService: {
    getBackupById: jest.Mock;
  };
  let service: RestoreService;

  beforeEach(async () => {
    mockRestoreRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      tryCreateWithLease: jest.fn().mockResolvedValue(jobId),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      startIfLeaseActive: jest.fn().mockResolvedValue(true),
      failPendingIfLeaseInactive: jest.fn().mockResolvedValue(undefined),
    };
    mockRestoreLeaseRepository = {
      release: jest.fn().mockResolvedValue(true),
      releaseByJobId: jest.fn().mockResolvedValue(true),
      renew: jest.fn().mockResolvedValue(true),
    };
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: jobId }),
      getJob: jest.fn(),
    };
    mockSseService = {
      register: jest.fn(),
      emit: jest.fn(),
      complete: jest.fn(),
    };
    mockConnectionsService = {
      findById: jest.fn().mockResolvedValue({
        id: targetConnectionId,
        name: 'Staging DB',
        environment: Environment.DEV,
        dbType: DbTypeEnum.POSTGRES,
      }),
    };
    mockBackupService = {
      getBackupById: jest.fn().mockResolvedValue({
        id: 'backup-1',
        dbType: DbTypeEnum.POSTGRES,
        status: JobStatus.COMPLETED,
        fileKey: 'prod-db/manual/test.dump',
        sha256: 'a'.repeat(64),
        bytes: 1024,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: mockRestoreRepository },
        { provide: RestoreLeaseRepository, useValue: mockRestoreLeaseRepository },
        {
          provide: RestoreExecutionOwnershipService,
          useValue: {
            tryAcquire: jest.fn().mockResolvedValue({ targetConnectionId }),
            release: jest.fn().mockResolvedValue(undefined),
            findActiveTarget: jest.fn().mockResolvedValue({
              id: targetConnectionId,
              name: 'Staging DB',
              environment: Environment.DEV,
              dbType: DbTypeEnum.POSTGRES,
            }),
            hasActiveLease: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: RestoreStagingService,
          useValue: {
            create: jest.fn().mockResolvedValue({ directoryPath: 'staging', dumpFilePath: 'staging/dump' }),
            cleanup: jest.fn().mockResolvedValue(undefined),
            writeDump: jest.fn().mockResolvedValue({ sha256: 'a'.repeat(64), bytes: 1024 }),
            checkAvailableDiskSpace: jest.fn().mockResolvedValue({ availableBytes: 1024 * 1024 * 500, requiredBytes: 1024 }),
          },
        },
        {
          provide: R2Service,
          useValue: {
            download: jest.fn().mockResolvedValue(Readable.from('dump content')),
            downloadJson: jest.fn().mockResolvedValue(null),
            getObjectSize: jest.fn().mockResolvedValue(1024),
          },
        },
        { provide: BackupService, useValue: mockBackupService },
        { provide: ConnectionsService, useValue: mockConnectionsService },
        { provide: SseService, useValue: mockSseService },
        { provide: getQueueToken(RESTORE_QUEUE_NAME), useValue: mockQueue },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([
            [DbTypeEnum.POSTGRES, { execute: jest.fn().mockResolvedValue(undefined) }],
          ]),
        },
      ],
    }).compile();

    service = module.get<RestoreService>(RestoreService);
  });

  it('createRestore enqueues restore job into BullMQ restore queue', async () => {
    const dto = {
      targetConnectionId,
      sourceBackupId: 'backup-1',
      isDryRun: false,
    };

    const result = await service.createRestore(dto, testUser);

    expect(result.jobId).toBe(jobId);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'process-restore',
      expect.objectContaining({
        jobId,
        dto,
        user: testUser,
        leaseToken: expect.any(String),
      }),
      expect.objectContaining({
        attempts: 1,
      }),
    );
  });

  it('cancelRestore throws NotFoundException when job does not exist', async () => {
    mockRestoreRepository.findById.mockResolvedValue(null);

    await expect(service.cancelRestore('unknown-id', testUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('cancelRestore throws ConflictException when job is already completed', async () => {
    mockRestoreRepository.findById.mockResolvedValue({
      id: jobId,
      status: JobStatus.COMPLETED,
    });

    await expect(service.cancelRestore(jobId, testUser)).rejects.toThrow(
      ConflictException,
    );
  });

  it('cancelRestore cancels pending restore job and releases lease', async () => {
    const mockBullJob = { remove: jest.fn().mockResolvedValue(undefined) };
    mockRestoreRepository.findById.mockResolvedValue({
      id: jobId,
      status: JobStatus.PENDING,
      targetConnectionId,
    });
    mockQueue.getJob.mockResolvedValue(mockBullJob);

    const result = await service.cancelRestore(jobId, testUser);

    expect(result.status).toBe(JobStatus.FAILED);
    expect(mockBullJob.remove).toHaveBeenCalled();
    expect(mockRestoreLeaseRepository.releaseByJobId).toHaveBeenCalledWith(jobId);
    expect(mockRestoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.FAILED,
      expect.objectContaining({
        errorMessage: 'Operación cancelada por el usuario',
      }),
    );
    expect(mockSseService.complete).toHaveBeenCalledWith(jobId);
  });
});


describe('RestoreService deadline of the whole restore', () => {
  const targetConnectionId = '00000000-0000-0000-0000-000000000001';
  const jobId = '00000000-0000-0000-0000-000000000002';
  const leaseToken = '00000000-0000-0000-0000-000000000003';
  const testUser: AuthUser = {
    id: 'user-1',
    email: 'admin@envault.local',
    name: 'Admin',
    role: 'admin',
  };
  const DEADLINE_MS = 120_000;
  const DEADLINE_MESSAGE = 'Restore exceeded the time limit of 2 min (RESTORE_TIMEOUT_MS)';
  const CANCEL_MESSAGE = 'Operación cancelada por el usuario';
  const dto = { targetConnectionId, sourceBackupId: 'backup-1', isDryRun: false };

  const target = {
    id: targetConnectionId,
    name: 'Test Target',
    dbType: DbTypeEnum.POSTGRES,
    environment: Environment.DEV,
  };

  /** Settles when the signal fires, the way an aborted R2 request or CLI does. */
  const hangsUntilAborted =
    (message: string) =>
    (...args: unknown[]) => {
      const options = args[args.length - 1] as { abortSignal?: AbortSignal } | undefined;
      return new Promise<never>((_resolve, reject) => {
        options?.abortSignal?.addEventListener('abort', () => reject(new Error(message)));
      });
    };

  async function build(
    options: {
      timeoutMs?: number;
      download?: jest.Mock;
      getObjectSize?: jest.Mock;
      execute?: jest.Mock;
      backup?: Record<string, unknown>;
      startIfLeaseActive?: jest.Mock;
    } = {},
  ) {
    const restoreRepository = {
      startIfLeaseActive: options.startIfLeaseActive ?? jest.fn().mockResolvedValue(true),
      failPendingIfLeaseInactive: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      findById: jest
        .fn()
        .mockResolvedValue({ id: jobId, status: JobStatus.RUNNING, targetConnectionId }),
    };
    const leaseRepository = {
      renew: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(true),
      releaseByJobId: jest.fn().mockResolvedValue(true),
    };
    const ownership = {
      tryAcquire: jest.fn().mockResolvedValue({ targetConnectionId }),
      release: jest.fn().mockResolvedValue(undefined),
      findActiveTarget: jest.fn().mockResolvedValue(target),
      hasActiveLease: jest.fn().mockResolvedValue(true),
    };
    const staging = {
      create: jest.fn().mockResolvedValue({ directoryPath: 'staging', dumpFilePath: 'staging/dump' }),
      writeDump: jest.fn().mockResolvedValue({ sha256: 'a'.repeat(64), bytes: 100 }),
      cleanup: jest.fn().mockResolvedValue(undefined),
      checkAvailableDiskSpace: jest.fn().mockResolvedValue({ availableBytes: 1, requiredBytes: 1 }),
    };
    const r2 = {
      getObjectSize: options.getObjectSize ?? jest.fn().mockResolvedValue(1024),
      download: options.download ?? jest.fn().mockResolvedValue(Readable.from('dump')),
      downloadJson: jest.fn().mockResolvedValue(null),
    };
    const sse = { register: jest.fn(), emit: jest.fn(), complete: jest.fn() };
    const execute = options.execute ?? jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: restoreRepository },
        { provide: RestoreLeaseRepository, useValue: leaseRepository },
        { provide: RestoreExecutionOwnershipService, useValue: ownership },
        { provide: RestoreStagingService, useValue: staging },
        { provide: R2Service, useValue: r2 },
        {
          provide: BackupService,
          useValue: {
            getBackupById: jest.fn().mockResolvedValue({
              id: 'backup-1',
              fileKey: 'backups/test.dump',
              dbType: DbTypeEnum.POSTGRES,
              status: JobStatus.COMPLETED,
              ...options.backup,
            }),
          },
        },
        { provide: ConnectionsService, useValue: { findById: jest.fn().mockResolvedValue(target) } },
        { provide: SseService, useValue: sse },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'RESTORE_TIMEOUT_MS' ? (options.timeoutMs ?? DEADLINE_MS) : undefined,
          },
        },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([[DbTypeEnum.POSTGRES, { execute }]]),
        },
      ],
    }).compile();

    const service = module.get(RestoreService);
    return {
      service,
      restoreRepository,
      leaseRepository,
      ownership,
      staging,
      r2,
      sse,
      execute,
      run: () => service.executeRestoreAsync(jobId, dto, testUser, leaseToken),
    };
  }

  /** The mocks resolve on microtasks; a few turns of the fake clock drain them. */
  const settled = async () => {
    for (let i = 0; i < 5; i += 1) await jest.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('ends a restore stuck in the download at RESTORE_TIMEOUT_MS, with the deadline message, and cleans up', async () => {
    const t = await build({ download: jest.fn(hangsUntilAborted('Request aborted')) });

    const finished = t.run();
    await settled();
    expect(t.restoreRepository.updateStatus).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(t.restoreRepository.updateStatus).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await finished;

    expect(t.restoreRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.FAILED,
      expect.objectContaining({ errorMessage: DEADLINE_MESSAGE, completedAt: expect.any(Date) }),
    );
    expect(t.sse.emit).toHaveBeenCalledWith(jobId, {
      type: 'failed',
      payload: { jobId, error: DEADLINE_MESSAGE },
    });
    expect(t.staging.cleanup).toHaveBeenCalledTimes(1);
    expect(t.ownership.release).toHaveBeenCalledTimes(1);
    expect(t.leaseRepository.release).toHaveBeenCalledWith(targetConnectionId, jobId, leaseToken);
    expect(t.sse.complete).toHaveBeenCalledWith(jobId);
    expect(t.execute).not.toHaveBeenCalled();
    // Nothing keeps running: neither the lease renewal nor the deadline.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('puts the deadline into every R2 step and into the download of the dump', async () => {
    const t = await build({ backup: { sha256: undefined } });

    await t.run();

    const signalOf = (call: unknown[]) =>
      (call[call.length - 1] as { abortSignal: AbortSignal }).abortSignal;
    expect(t.r2.getObjectSize).toHaveBeenCalledWith('backups/test.dump', {
      abortSignal: expect.any(AbortSignal),
    });
    expect(t.r2.download).toHaveBeenCalledWith('backups/test.dump', {
      abortSignal: expect.any(AbortSignal),
    });
    expect(t.r2.downloadJson).toHaveBeenCalledWith('backups/test.manifest.json', {
      abortSignal: expect.any(AbortSignal),
    });
    expect(t.staging.writeDump).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      signal: expect.any(AbortSignal),
    });
    // One signal for the whole run, the one the strategy gets.
    const strategySignal = (t.execute.mock.calls[0][3] as { abortSignal: AbortSignal }).abortSignal;
    expect(signalOf(t.r2.getObjectSize.mock.calls[0])).toBe(strategySignal);
    expect(signalOf(t.r2.download.mock.calls[0])).toBe(strategySignal);
    expect(signalOf(t.r2.downloadJson.mock.calls[0])).toBe(strategySignal);
  });

  it('disarms the deadline when the restore finishes in time', async () => {
    const t = await build();

    await t.run();
    await jest.advanceTimersByTimeAsync(10 * DEADLINE_MS);

    expect(t.restoreRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.COMPLETED,
      expect.anything(),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('classifies by the reason of the abort, never by the message of the error', async () => {
    // Every strategy rejects an aborted signal with the cancel text, whatever fired it.
    const t = await build({ download: jest.fn(hangsUntilAborted(CANCEL_MESSAGE)) });

    const finished = t.run();
    await settled();
    await jest.advanceTimersByTimeAsync(DEADLINE_MS);
    await finished;

    expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.FAILED,
      expect.objectContaining({ errorMessage: DEADLINE_MESSAGE }),
    );
  });

  it('keeps the cancel message for a user cancel, whatever the aborted step says', async () => {
    const t = await build({ download: jest.fn(hangsUntilAborted('Request aborted')) });

    const finished = t.run();
    await settled();
    await expect(t.service.cancelRestore(jobId, testUser)).resolves.toMatchObject({
      status: JobStatus.FAILED,
    });
    await finished;

    expect(t.restoreRepository.updateStatus).toHaveBeenCalledTimes(1);
    expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.FAILED,
      expect.objectContaining({ errorMessage: CANCEL_MESSAGE }),
    );
    expect(t.sse.emit).toHaveBeenCalledWith(jobId, {
      type: 'failed',
      payload: { jobId, error: CANCEL_MESSAGE },
    });
    // The deadline was disarmed with the run.
    await jest.advanceTimersByTimeAsync(10 * DEADLINE_MS);
    expect(t.restoreRepository.updateStatus).toHaveBeenCalledTimes(1);
  });

  describe('when the deadline fires while the MySQL swap is running', () => {
    /** A strategy that ignores the signal until the test lets it end, as the swap does. */
    function swap() {
      let finish: () => void = () => undefined;
      let fail: (error: Error) => void = () => undefined;
      let signal: AbortSignal | undefined;
      const execute = jest.fn(
        (_connection: unknown, _path: string, _log: unknown, options: { abortSignal: AbortSignal }) => {
          signal = options.abortSignal;
          return new Promise<void>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          });
        },
      );
      return {
        execute,
        finish: () => finish(),
        fail: (error: Error) => fail(error),
        signal: () => signal,
      };
    }

    it('lets it finish and reports COMPLETED, because the target changed', async () => {
      const s = swap();
      const t = await build({ execute: s.execute });

      const finished = t.run();
      await settled();
      await jest.advanceTimersByTimeAsync(DEADLINE_MS);
      expect(s.signal()?.aborted).toBe(true);
      expect(t.restoreRepository.updateStatus).not.toHaveBeenCalled();

      s.finish();
      await finished;

      expect(t.restoreRepository.updateStatus).toHaveBeenCalledTimes(1);
      expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
        jobId,
        JobStatus.COMPLETED,
        expect.objectContaining({ completedAt: expect.any(Date) }),
      );
      expect(t.sse.emit).toHaveBeenCalledWith(jobId, expect.objectContaining({ type: 'completed' }));
      expect(t.sse.emit).not.toHaveBeenCalledWith(jobId, expect.objectContaining({ type: 'failed' }));
      // The log says why the job lasted longer than the limit.
      expect(t.sse.emit).toHaveBeenCalledWith(jobId, {
        type: 'log',
        payload: {
          message: expect.stringContaining('time limit'),
          timestamp: expect.any(Date),
        },
      });
    });

    it('keeps the lease renewing and the target protected until the swap ends', async () => {
      const s = swap();
      const t = await build({ execute: s.execute });

      const finished = t.run();
      await settled();
      await jest.advanceTimersByTimeAsync(DEADLINE_MS);
      const renewalsAtDeadline = t.leaseRepository.renew.mock.calls.length;

      await jest.advanceTimersByTimeAsync(180_000);

      expect(t.leaseRepository.renew.mock.calls.length).toBe(renewalsAtDeadline + 3);
      expect(t.leaseRepository.release).not.toHaveBeenCalled();
      expect(t.ownership.release).not.toHaveBeenCalled();

      s.finish();
      await finished;
      expect(t.leaseRepository.release).toHaveBeenCalledTimes(1);
      expect(t.ownership.release).toHaveBeenCalledTimes(1);
    });

    it('fails with the deadline message when the swap rolled back cleanly', async () => {
      const s = swap();
      const t = await build({ execute: s.execute });

      const finished = t.run();
      await settled();
      await jest.advanceTimersByTimeAsync(DEADLINE_MS);
      s.fail(new Error(CANCEL_MESSAGE));
      await finished;

      expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
        jobId,
        JobStatus.FAILED,
        expect.objectContaining({ errorMessage: DEADLINE_MESSAGE }),
      );
    });

    it('keeps the message that names the pre-restore database when the rollback failed', async () => {
      const s = swap();
      const t = await build({ execute: s.execute });

      const finished = t.run();
      await settled();
      await jest.advanceTimersByTimeAsync(DEADLINE_MS);
      s.fail(
        new RestoreRollbackError('app_pre_restore_1', new Error('swap'), new Error('rollback'), {
          renamed: true,
        }),
      );
      await finished;

      const [, status, details] = t.restoreRepository.updateStatus.mock.calls[0];
      expect(status).toBe(JobStatus.FAILED);
      expect(details.errorMessage).toContain('app_pre_restore_1');
      expect(details.errorMessage).not.toBe(DEADLINE_MESSAGE);
    });
  });

  it('starts counting when the restore starts running, not when it was admitted', async () => {
    let start: (started: boolean) => void = () => undefined;
    const startIfLeaseActive = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          start = resolve;
        }),
    );
    const t = await build({ startIfLeaseActive });

    const finished = t.run();
    await settled();
    // Waiting for its turn for longer than the limit.
    await jest.advanceTimersByTimeAsync(3 * DEADLINE_MS);
    start(true);
    await finished;

    expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.COMPLETED,
      expect.anything(),
    );
  });

  it.each([
    [1_800_000, '30 min'],
    [90_000, '1.5 min'],
    [10_000, '10 s'],
  ])('words a limit of %p ms as %p', async (timeoutMs, wording) => {
    const t = await build({ timeoutMs, download: jest.fn(hangsUntilAborted('Request aborted')) });

    const finished = t.run();
    await settled();
    await jest.advanceTimersByTimeAsync(timeoutMs);
    await finished;

    expect(t.restoreRepository.updateStatus).toHaveBeenCalledWith(
      jobId,
      JobStatus.FAILED,
      expect.objectContaining({
        errorMessage: `Restore exceeded the time limit of ${wording} (RESTORE_TIMEOUT_MS)`,
      }),
    );
  });
});
