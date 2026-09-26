/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';
import { BackupLeaseRepository } from './backup-lease.repository';
import { R2Service } from './r2.service';
import { ConnectionsService } from '../connections/connections.service';
import { SseService } from '../../shared/sse/sse.service';
import { BACKUP_QUEUE_NAME } from './backup.constants';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';

describe('BackupService', () => {
  let service: BackupService;
  let mockBackupRepository: {
    create: jest.Mock;
    updateStatus: jest.Mock;
    findById: jest.Mock;
    findActiveJobForConnection: jest.Mock;
    findAllUnfinished: jest.Mock;
    failPendingStale: jest.Mock;
    failRunningWithoutLease: jest.Mock;
    startIfRunnable: jest.Mock;
    markFailedIfUnfinished: jest.Mock;
    failIfLeaseHeld: jest.Mock;
    completeIfLeaseHeld: jest.Mock;
  };
  let mockBackupLeaseRepository: {
    tryAcquire: jest.Mock;
    renew: jest.Mock;
    release: jest.Mock;
  };
  let mockR2Service: {
    upload: jest.Mock;
    delete: jest.Mock;
  };
  let mockConnectionsService: {
    findById: jest.Mock;
  };
  let mockSseService: {
    register: jest.Mock;
    emit: jest.Mock;
    complete: jest.Mock;
  };
  let mockQueue: {
    add: jest.Mock;
    getJob?: jest.Mock;
    getJobState: jest.Mock;
  };
  let mockStrategy: {
    execute: jest.Mock;
  };

  const mockUser = {
    id: 'user-1',
    email: 'admin@vaultly.local',
    name: 'Admin',
    role: 'admin',
  };

  const mockConnection: Partial<ConnectionEntity> = {
    id: 'conn-1',
    name: 'Prod DB',
    slug: 'prod-db',
    environment: Environment.PROD,
    dbType: DbTypeEnum.POSTGRES,
    database: 'main',
  };

  beforeEach(async () => {
    mockBackupRepository = {
      create: jest.fn(),
      updateStatus: jest.fn(),
      findById: jest.fn(),
      findActiveJobForConnection: jest.fn().mockResolvedValue(null),
      findAllUnfinished: jest.fn().mockResolvedValue([]),
      failPendingStale: jest.fn().mockResolvedValue(false),
      failRunningWithoutLease: jest.fn().mockResolvedValue(false),
      startIfRunnable: jest.fn().mockResolvedValue(true),
      markFailedIfUnfinished: jest.fn().mockResolvedValue(true),
      failIfLeaseHeld: jest.fn().mockResolvedValue(true),
      completeIfLeaseHeld: jest.fn().mockResolvedValue(true),
    };
    mockBackupLeaseRepository = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      renew: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(true),
    };
    mockR2Service = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    mockConnectionsService = {
      findById: jest.fn().mockResolvedValue(mockConnection),
    };
    mockSseService = {
      register: jest.fn(),
      emit: jest.fn(),
      complete: jest.fn(),
    };
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'bull-1' }),
      getJobState: jest.fn().mockResolvedValue('unknown'),
    };
    mockStrategy = {
      execute: jest.fn().mockResolvedValue({
        fileSizeMb: 12.5,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        bytes: 13107200,
      }),
    };

    const strategiesMap = new Map();
    strategiesMap.set(DbTypeEnum.POSTGRES, mockStrategy);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupService,
        { provide: BackupRepository, useValue: mockBackupRepository },
        { provide: BackupLeaseRepository, useValue: mockBackupLeaseRepository },
        { provide: R2Service, useValue: mockR2Service },
        { provide: ConnectionsService, useValue: mockConnectionsService },
        { provide: SseService, useValue: mockSseService },
        { provide: getQueueToken(BACKUP_QUEUE_NAME), useValue: mockQueue },
        { provide: 'BACKUP_STRATEGIES', useValue: strategiesMap },
      ],
    }).compile();

    service = module.get<BackupService>(BackupService);
    jest.spyOn(service as never, 'captureSourceSnapshot' as never).mockResolvedValue({
      serverVersion: 'PostgreSQL 16.0',
      tableCount: 1,
      estimatedRows: 10,
      tables: [{ name: 'users', estimatedRows: 10 }],
    } as never);
  });

  it('createBackup enqueues job in BullMQ and registers SSE', async () => {
    mockBackupRepository.create.mockResolvedValue({
      id: 'job-123',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/test.dump',
    });

    const result = await service.createBackup(
      { connectionId: 'conn-1' },
      mockUser,
      BackupCategory.MANUAL,
    );

    expect(result.jobId).toBe('job-123');
    expect(result.status).toBe(JobStatus.PENDING);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'process-backup',
      { jobId: 'job-123' },
      expect.objectContaining({ attempts: 2 }),
    );
    expect(mockSseService.register).toHaveBeenCalledWith('job-123');
  });

  it('createBackup reuses pending job ticket if a job is already PENDING in queue for connection', async () => {
    mockBackupRepository.findActiveJobForConnection.mockResolvedValue({
      id: 'active-job-pending',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/pending.dump',
      createdAt: new Date(),
    });

    const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

    expect(result.jobId).toBe('active-job-pending');
    expect(result.status).toBe(JobStatus.PENDING);
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockBackupRepository.create).not.toHaveBeenCalled();
  });

  it('createBackup queues new backup if another job is currently RUNNING for connection', async () => {
    mockBackupRepository.findActiveJobForConnection.mockResolvedValue({
      id: 'active-job-running',
      status: JobStatus.RUNNING,
      createdAt: new Date(),
    });

    mockBackupRepository.create.mockResolvedValue({
      id: 'new-job-456',
      connectionId: 'conn-1',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/new.dump',
    });

    const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

    expect(result.jobId).toBe('new-job-456');
    expect(result.status).toBe(JobStatus.PENDING);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'process-backup',
      { jobId: 'new-job-456' },
      expect.anything(),
    );
  });

  it('createBackup marks zombie job as FAILED if older than BACKUP_TIMEOUT_MS and creates new backup', async () => {
    const twoHoursAgo = new Date(Date.now() - 7_200_000);
    mockBackupRepository.findActiveJobForConnection.mockResolvedValue({
      id: 'zombie-job-999',
      status: JobStatus.RUNNING,
      createdAt: twoHoursAgo,
      startedAt: twoHoursAgo,
    });

    mockBackupRepository.create.mockResolvedValue({
      id: 'recovered-job-789',
      connectionId: 'conn-1',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/recovered.dump',
    });

    const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

    expect(mockBackupRepository.updateStatus).toHaveBeenCalledWith(
      'zombie-job-999',
      JobStatus.FAILED,
      expect.objectContaining({
        errorMessage: expect.stringContaining('timeout'),
      }),
    );
    expect(result.jobId).toBe('recovered-job-789');
    expect(mockQueue.add).toHaveBeenCalled();
  });

  describe('sweepOrphans', () => {
    it('leaves a RUNNING job alone when its lease is still live', async () => {
      mockBackupRepository.findAllUnfinished.mockResolvedValue([
        { id: 'running-1', connectionId: 'conn-1', status: JobStatus.RUNNING },
      ]);
      mockBackupRepository.failRunningWithoutLease.mockResolvedValue(false);

      await service.sweepOrphans();

      expect(mockBackupRepository.failRunningWithoutLease).toHaveBeenCalledWith(
        'running-1',
        expect.any(String),
        expect.any(Date),
      );
      expect(mockQueue.getJobState).not.toHaveBeenCalled();
      expect(mockBackupRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('fails a RUNNING job with no live lease', async () => {
      mockBackupRepository.findAllUnfinished.mockResolvedValue([
        { id: 'running-2', connectionId: 'conn-1', status: JobStatus.RUNNING },
      ]);
      mockBackupRepository.failRunningWithoutLease.mockResolvedValue(true);

      await service.sweepOrphans();

      expect(mockBackupRepository.failRunningWithoutLease).toHaveBeenCalledWith(
        'running-2',
        expect.stringContaining('interrumpido'),
        expect.any(Date),
      );
    });

    it('leaves a PENDING job alone when its BullMQ job still exists', async () => {
      mockBackupRepository.findAllUnfinished.mockResolvedValue([
        { id: 'pending-1', connectionId: 'conn-1', status: JobStatus.PENDING },
      ]);
      mockQueue.getJobState.mockResolvedValue('delayed');

      await service.sweepOrphans();

      expect(mockQueue.getJobState).toHaveBeenCalledWith('pending-1');
      expect(mockBackupRepository.failPendingStale).not.toHaveBeenCalled();
    });

    it('defers to the 60s grace period when a PENDING job has no matching BullMQ job', async () => {
      mockBackupRepository.findAllUnfinished.mockResolvedValue([
        { id: 'pending-2', connectionId: 'conn-1', status: JobStatus.PENDING },
      ]);
      mockQueue.getJobState.mockResolvedValue('unknown');
      mockBackupRepository.failPendingStale.mockResolvedValue(false);

      await service.sweepOrphans();

      expect(mockBackupRepository.failPendingStale).toHaveBeenCalledWith(
        'pending-2',
        expect.stringContaining('interrumpido'),
        expect.any(Date),
      );
    });

    it('fails a stale PENDING job once the grace period has elapsed', async () => {
      mockBackupRepository.findAllUnfinished.mockResolvedValue([
        { id: 'pending-3', connectionId: 'conn-1', status: JobStatus.PENDING },
      ]);
      mockQueue.getJobState.mockResolvedValue('failed');
      mockBackupRepository.failPendingStale.mockResolvedValue(true);

      await service.sweepOrphans();

      expect(mockBackupRepository.failPendingStale).toHaveBeenCalledWith(
        'pending-3',
        expect.stringContaining('interrumpido'),
        expect.any(Date),
      );
    });

    it('skips a row and continues when checking its BullMQ state fails', async () => {
      mockBackupRepository.findAllUnfinished.mockResolvedValue([
        { id: 'pending-4', connectionId: 'conn-1', status: JobStatus.PENDING },
        { id: 'running-3', connectionId: 'conn-2', status: JobStatus.RUNNING },
      ]);
      mockQueue.getJobState.mockRejectedValue(new Error('Redis unavailable'));
      mockBackupRepository.failRunningWithoutLease.mockResolvedValue(true);

      await expect(service.sweepOrphans()).resolves.not.toThrow();

      expect(mockBackupRepository.failPendingStale).not.toHaveBeenCalled();
      expect(mockBackupRepository.failRunningWithoutLease).toHaveBeenCalledWith(
        'running-3',
        expect.any(String),
        expect.any(Date),
      );
    });
  });

  it('executeQueuedBackup uploads manifest v2 and updates DB with sha256 and bytes upon completion', async () => {
    const mockJob: Partial<BackupJobEntity> = {
      id: 'job-123',
      connectionId: 'conn-1',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/test.dump',
      category: BackupCategory.MANUAL,
      triggeredBy: mockUser.id,
    };
    mockBackupRepository.findById.mockResolvedValue(mockJob);

    const outcome = await service.executeQueuedBackup('job-123');

    expect(outcome.kind).toBe('finished');
    if (outcome.kind !== 'finished') throw new Error('expected finished outcome');
    expect(outcome.result.sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(outcome.result.bytes).toBe(13107200);
    expect(outcome.result.fileSizeMb).toBe(12.5);

    expect(mockR2Service.upload).toHaveBeenCalledTimes(1);
    const uploadedManifestKey = mockR2Service.upload.mock.calls[0][0];
    expect(uploadedManifestKey).toContain('.manifest.json');

    expect(mockBackupLeaseRepository.tryAcquire).toHaveBeenCalledWith(
      'conn-1',
      'job-123',
      expect.any(String),
      expect.any(Number),
    );
    expect(mockBackupRepository.startIfRunnable).toHaveBeenCalledWith(
      'job-123',
      expect.any(Date),
      false,
    );
    expect(mockBackupRepository.completeIfLeaseHeld).toHaveBeenCalledWith(
      'job-123',
      'conn-1',
      expect.any(String),
      expect.objectContaining({
        fileSizeMb: 12.5,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        bytes: 13107200,
      }),
    );
    expect(mockSseService.complete).toHaveBeenCalledWith('job-123');
    expect(mockBackupLeaseRepository.release).toHaveBeenCalledWith(
      'conn-1',
      'job-123',
      expect.any(String),
    );
  });

  it('executeQueuedBackup updates DB to FAILED and completes SSE when strategy fails', async () => {
    mockBackupRepository.findById.mockResolvedValue({
      id: 'job-123',
      connectionId: 'conn-1',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/test.dump',
      category: BackupCategory.MANUAL,
      triggeredBy: mockUser.id,
    });
    mockStrategy.execute.mockRejectedValue(new Error('pg_dump connection lost'));

    await expect(service.executeQueuedBackup('job-123')).rejects.toThrow();

    expect(mockBackupRepository.failIfLeaseHeld).toHaveBeenCalledWith(
      'job-123',
      'conn-1',
      expect.any(String),
      expect.stringContaining('pg_dump connection lost'),
      expect.any(Date),
    );
    expect(mockSseService.emit).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        type: 'failed',
      }),
    );
    expect(mockSseService.complete).toHaveBeenCalledWith('job-123');
  });

  describe('cancelBackup', () => {
    it('throws NotFoundException when job does not exist', async () => {
      mockBackupRepository.findById.mockResolvedValue(null);

      await expect(service.cancelBackup('unknown-id', mockUser)).rejects.toThrow();
    });

    it('throws ConflictException when job is already completed', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.COMPLETED,
      });

      await expect(service.cancelBackup('job-1', mockUser)).rejects.toThrow();
    });

    it('cancels pending backup job from BullMQ and marks FAILED', async () => {
      const mockBullJob = { remove: jest.fn().mockResolvedValue(undefined) };
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-pending',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/pending.dump',
      });
      mockQueue.getJob = jest.fn().mockResolvedValue(mockBullJob);

      const result = await service.cancelBackup('job-pending', mockUser);

      expect(result.status).toBe(JobStatus.FAILED);
      expect(mockBullJob.remove).toHaveBeenCalled();
      expect(mockBackupRepository.updateStatus).toHaveBeenCalledWith(
        'job-pending',
        JobStatus.FAILED,
        expect.objectContaining({
          errorMessage: 'Operación cancelada por el usuario',
        }),
      );
      expect(mockR2Service.delete).toHaveBeenCalledWith('prod-db/manual/pending.dump');
      expect(mockSseService.complete).toHaveBeenCalledWith('job-pending');
    });

    it('cancels running backup job by triggering active abort controller', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-running',
        connectionId: 'conn-1',
        status: JobStatus.RUNNING,
        fileKey: 'prod-db/manual/running.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });

      mockStrategy.execute.mockImplementation((_conn, _key, _meta, options) => {
        return new Promise((_resolve, reject) => {
          options?.abortSignal?.addEventListener('abort', () => {
            reject(new Error('Operación cancelada por el usuario'));
          });
          setImmediate(() => {
            void service.cancelBackup('job-running', mockUser);
          });
        });
      });

      const outcome = await service.executeQueuedBackup('job-running');

      expect(outcome.kind).toBe('finished');
      if (outcome.kind !== 'finished') throw new Error('expected finished outcome');
      expect(outcome.result.status).toBe(JobStatus.FAILED);
      expect(mockBackupRepository.failIfLeaseHeld).toHaveBeenCalledWith(
        'job-running',
        'conn-1',
        expect.any(String),
        'Operación cancelada por el usuario',
        expect.any(Date),
      );
      expect(mockR2Service.delete).toHaveBeenCalledWith('prod-db/manual/running.dump');
      expect(mockBackupLeaseRepository.release).toHaveBeenCalledWith(
        'conn-1',
        'job-running',
        expect.any(String),
      );
    });

    it('does not re-execute a permanently FAILED job (terminal-status guard)', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-cancelled',
        connectionId: 'conn-1',
        status: JobStatus.FAILED,
        fileKey: 'prod-db/manual/cancelled.dump',
      });

      const outcome = await service.executeQueuedBackup('job-cancelled');

      expect(outcome).toEqual({ kind: 'skipped', status: JobStatus.FAILED });
      expect(mockBackupLeaseRepository.tryAcquire).not.toHaveBeenCalled();
      expect(mockBackupRepository.startIfRunnable).not.toHaveBeenCalled();
    });

    it('re-executes a FAILED job when it is our own attempts:2 retry', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-retry',
        connectionId: 'conn-1',
        status: JobStatus.FAILED,
        fileKey: 'prod-db/manual/retry.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });

      const outcome = await service.executeQueuedBackup('job-retry', { isRetry: true });

      expect(outcome.kind).toBe('finished');
      expect(mockBackupLeaseRepository.tryAcquire).toHaveBeenCalledWith(
        'conn-1',
        'job-retry',
        expect.any(String),
        expect.any(Number),
      );
      expect(mockBackupRepository.startIfRunnable).toHaveBeenCalledWith(
        'job-retry',
        expect.any(Date),
        true,
      );
    });

    it('defers instead of running when the connection already has a live lease', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-busy',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/busy.dump',
      });
      mockBackupLeaseRepository.tryAcquire.mockResolvedValue(false);

      const outcome = await service.executeQueuedBackup('job-busy');

      expect(outcome).toEqual({ kind: 'deferred' });
      expect(mockBackupRepository.startIfRunnable).not.toHaveBeenCalled();
      expect(mockBackupLeaseRepository.release).not.toHaveBeenCalled();
    });

    it('skips execution and releases the lease when startIfRunnable loses the race', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-race',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/race.dump',
      });
      mockBackupRepository.startIfRunnable.mockResolvedValue(false);

      const outcome = await service.executeQueuedBackup('job-race');

      expect(outcome).toEqual({ kind: 'skipped', status: JobStatus.PENDING });
      expect(mockBackupLeaseRepository.release).toHaveBeenCalledWith(
        'conn-1',
        'job-race',
        expect.any(String),
      );
    });

    it('releases the lease in finally after a successful run', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-clean',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/clean.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });

      await service.executeQueuedBackup('job-clean');

      expect(mockBackupLeaseRepository.release).toHaveBeenCalledWith(
        'conn-1',
        'job-clean',
        expect.any(String),
      );
    });

    it('rethrows for BullMQ retry when a heartbeat renewal returns false (lease lost), instead of treating it like a cancel', async () => {
      // Regression test for the classification bug fixed by reusing
      // `abortState.reason` (see the removed `rawMessage.includes(...)`
      // fallback below): BullMQ's strategies reject with the SAME hardcoded
      // message for every abort reason, so matching on the message alone
      // misclassified a lost lease as a user cancel and swallowed the retry.
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      try {
        mockBackupRepository.findById.mockResolvedValue({
          id: 'job-lease-lost',
          connectionId: 'conn-1',
          status: JobStatus.PENDING,
          fileKey: 'prod-db/manual/lease-lost.dump',
          category: BackupCategory.MANUAL,
          triggeredBy: mockUser.id,
        });
        mockBackupLeaseRepository.renew.mockResolvedValue(false);

        mockStrategy.execute.mockImplementation((_conn, _key, _meta, options) => {
          return new Promise((_resolve, reject) => {
            options?.abortSignal?.addEventListener('abort', () => {
              reject(new Error('Operación cancelada por el usuario'));
            });
          });
        });

        const pending = service.executeQueuedBackup('job-lease-lost');
        // Attach the rejection assertion synchronously, before advancing
        // timers, so Node never sees an unhandled rejection window.
        const assertion = expect(pending).rejects.toThrow();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(60_000);

        await assertion;

        expect(mockBackupLeaseRepository.renew).toHaveBeenCalledWith(
          'conn-1',
          'job-lease-lost',
          expect.any(String),
          expect.any(Number),
        );
        expect(mockBackupRepository.failIfLeaseHeld).toHaveBeenCalledWith(
          'job-lease-lost',
          'conn-1',
          expect.any(String),
          expect.any(String),
          expect.any(Date),
        );
        expect(mockBackupLeaseRepository.release).toHaveBeenCalledWith(
          'conn-1',
          'job-lease-lost',
          expect.any(String),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('aborts on BACKUP_TIMEOUT_MS, marks the row FAILED, and throws UnrecoverableError instead of retrying', async () => {
      // 30 heartbeat ticks (1_800_000ms / 60_000ms) each flushing a real
      // Promise under fake timers pushes this past Jest's 5s default.
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      try {
        mockBackupRepository.findById.mockResolvedValue({
          id: 'job-timeout',
          connectionId: 'conn-1',
          status: JobStatus.PENDING,
          fileKey: 'prod-db/manual/timeout.dump',
          category: BackupCategory.MANUAL,
          triggeredBy: mockUser.id,
        });

        mockStrategy.execute.mockImplementation((_conn, _key, _meta, options) => {
          return new Promise((_resolve, reject) => {
            options?.abortSignal?.addEventListener('abort', () => {
              reject(new Error('Operación cancelada por el usuario'));
            });
          });
        });

        const pending = service.executeQueuedBackup('job-timeout');
        const assertion = expect(pending).rejects.toBeInstanceOf(UnrecoverableError);
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1_800_000);

        await assertion;

        expect(mockBackupRepository.failIfLeaseHeld).toHaveBeenCalledWith(
          'job-timeout',
          'conn-1',
          expect.any(String),
          expect.any(String),
          expect.any(Date),
        );
        expect(mockBackupLeaseRepository.release).toHaveBeenCalledWith(
          'conn-1',
          'job-timeout',
          expect.any(String),
        );
      } finally {
        jest.useRealTimers();
      }
    }, 20_000);

    it('throws UnrecoverableError when the backup job row no longer exists', async () => {
      mockBackupRepository.findById.mockResolvedValue(null);

      await expect(service.executeQueuedBackup('missing-job')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(mockBackupLeaseRepository.tryAcquire).not.toHaveBeenCalled();
    });

    it('throws UnrecoverableError when the connection targeted by the job is not in PROD', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-nonprod',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/nonprod.dump',
      });
      mockConnectionsService.findById.mockResolvedValue({
        ...mockConnection,
        environment: Environment.DEV,
      });

      await expect(service.executeQueuedBackup('job-nonprod')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(mockBackupLeaseRepository.tryAcquire).not.toHaveBeenCalled();
    });

    it('throws UnrecoverableError when no backup strategy is configured for the dbType', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-nostrategy',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/nostrategy.dump',
      });
      mockConnectionsService.findById.mockResolvedValue({
        ...mockConnection,
        dbType: DbTypeEnum.MYSQL,
      });

      await expect(service.executeQueuedBackup('job-nostrategy')).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(mockBackupLeaseRepository.tryAcquire).not.toHaveBeenCalled();
    });

    it('does not delete R2 or emit failed SSE when the failure write is fenced out by another lease owner', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-fenced-fail',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/fenced-fail.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });
      mockStrategy.execute.mockRejectedValue(new Error('pg_dump connection lost'));
      mockBackupRepository.failIfLeaseHeld.mockResolvedValue(false);

      await expect(service.executeQueuedBackup('job-fenced-fail')).rejects.toThrow();

      expect(mockBackupRepository.failIfLeaseHeld).toHaveBeenCalledWith(
        'job-fenced-fail',
        'conn-1',
        expect.any(String),
        expect.stringContaining('pg_dump connection lost'),
        expect.any(Date),
      );
      expect(mockR2Service.delete).not.toHaveBeenCalled();
      expect(mockSseService.emit).not.toHaveBeenCalledWith(
        'job-fenced-fail',
        expect.objectContaining({ type: 'failed' }),
      );
      expect(mockSseService.complete).not.toHaveBeenCalledWith('job-fenced-fail');
    });

    it('deletes R2 and emits failed SSE when the failure write is still owned by this lease', async () => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-owned-fail',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/owned-fail.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });
      mockStrategy.execute.mockRejectedValue(new Error('pg_dump connection lost'));
      mockBackupRepository.failIfLeaseHeld.mockResolvedValue(true);

      await expect(service.executeQueuedBackup('job-owned-fail')).rejects.toThrow();

      expect(mockR2Service.delete).toHaveBeenCalledWith('prod-db/manual/owned-fail.dump');
      expect(mockSseService.emit).toHaveBeenCalledWith(
        'job-owned-fail',
        expect.objectContaining({ type: 'failed' }),
      );
      expect(mockSseService.complete).toHaveBeenCalledWith('job-owned-fail');
    });

    it('does not emit completed SSE and returns skipped when the success write is fenced out by another lease owner', async () => {
      mockBackupRepository.findById
        .mockResolvedValueOnce({
          id: 'job-fenced-success',
          connectionId: 'conn-1',
          status: JobStatus.PENDING,
          fileKey: 'prod-db/manual/fenced-success.dump',
          category: BackupCategory.MANUAL,
          triggeredBy: mockUser.id,
        })
        .mockResolvedValueOnce({
          id: 'job-fenced-success',
          connectionId: 'conn-1',
          status: JobStatus.RUNNING,
        });
      mockBackupRepository.completeIfLeaseHeld.mockResolvedValue(false);

      const outcome = await service.executeQueuedBackup('job-fenced-success');

      expect(outcome).toEqual({ kind: 'skipped', status: JobStatus.RUNNING });
      expect(mockBackupRepository.completeIfLeaseHeld).toHaveBeenCalledWith(
        'job-fenced-success',
        'conn-1',
        expect.any(String),
        expect.objectContaining({
          fileSizeMb: 12.5,
          sha256: expect.any(String),
          bytes: 13107200,
        }),
      );
      expect(mockR2Service.delete).not.toHaveBeenCalled();
      expect(mockSseService.emit).not.toHaveBeenCalledWith(
        'job-fenced-success',
        expect.objectContaining({ type: 'completed' }),
      );
      expect(mockSseService.complete).not.toHaveBeenCalledWith('job-fenced-success');
    });
  });
});
