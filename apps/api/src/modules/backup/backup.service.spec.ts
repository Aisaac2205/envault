/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import { BackupService } from './backup.service';
import { isJobStreamClosed } from './backup-stream';
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

// The PostgreSQL source snapshot opens its own connection to the database being
// backed up; the specs below that exercise it answer from this fake client.
const mockPgClient = {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
};
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => mockPgClient),
}));

describe('BackupService', () => {
  let service: BackupService;
  let captureSourceSnapshotSpy: jest.SpyInstance;
  let mockBackupRepository: {
    create: jest.Mock;
    updateStatus: jest.Mock;
    findById: jest.Mock;
    insertPendingOrFindExisting: jest.Mock;
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
      insertPendingOrFindExisting: jest.fn(),
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
    captureSourceSnapshotSpy = jest
      .spyOn(service as never, 'captureSourceSnapshot' as never)
      .mockResolvedValue({
        serverVersion: 'PostgreSQL 16.0',
        tableCount: 1,
        estimatedRows: 10,
        tables: [{ name: 'users', estimatedRows: 10 }],
      } as never);
  });

  it('createBackup enqueues job in BullMQ and registers SSE', async () => {
    mockBackupRepository.insertPendingOrFindExisting.mockResolvedValue({
      created: true,
      job: {
        id: 'job-123',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/test.dump',
      },
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

  it('createBackup reuses the existing PENDING ticket when the atomic insert coalesces onto a live BullMQ job', async () => {
    mockBackupRepository.insertPendingOrFindExisting.mockResolvedValue({
      created: false,
      job: {
        id: 'active-job-pending',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/pending.dump',
        createdAt: new Date(),
      },
    });
    mockQueue.getJobState.mockResolvedValue('waiting');

    const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

    expect(result.jobId).toBe('active-job-pending');
    expect(result.status).toBe(JobStatus.PENDING);
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockBackupRepository.markFailedIfUnfinished).not.toHaveBeenCalled();
  });

  describe.each(['unknown', 'failed', 'completed'] as const)(
    'createBackup coalescing onto a dead pending job (BullMQ state: %s)',
    (deadState: 'unknown' | 'failed' | 'completed') => {
      it('marks the dead ticket FAILED and re-enqueues a fresh PENDING job instead of returning it', async () => {
        mockBackupRepository.insertPendingOrFindExisting
          .mockResolvedValueOnce({
            created: false,
            job: {
              id: 'dead-pending-job',
              status: JobStatus.PENDING,
              fileKey: 'prod-db/manual/dead.dump',
              createdAt: new Date(Date.now() - 5 * 60_000),
            },
          })
          .mockResolvedValueOnce({
            created: true,
            job: {
              id: 'fresh-job-789',
              status: JobStatus.PENDING,
              fileKey: 'prod-db/manual/fresh.dump',
            },
          });
        mockQueue.getJobState.mockResolvedValue(deadState);

        const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

        expect(mockBackupRepository.markFailedIfUnfinished).toHaveBeenCalledWith(
          'dead-pending-job',
          expect.any(String),
          expect.any(Date),
        );
        expect(mockBackupRepository.insertPendingOrFindExisting).toHaveBeenCalledTimes(2);
        expect(result.jobId).toBe('fresh-job-789');
        expect(result.status).toBe(JobStatus.PENDING);
        expect(mockQueue.add).toHaveBeenCalledWith(
          'process-backup',
          { jobId: 'fresh-job-789' },
          expect.anything(),
        );
      });
    },
  );

  it('createBackup treats a fresh PENDING ticket with no BullMQ job yet as in-flight, not dead', async () => {
    // A concurrent request inserted this row milliseconds ago and has not
    // reached queue.add yet, so BullMQ reports "unknown". Failing it here
    // would kill a live ticket.
    mockBackupRepository.insertPendingOrFindExisting.mockResolvedValue({
      created: false,
      job: {
        id: 'in-flight-job',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/in-flight.dump',
        createdAt: new Date(),
      },
    });
    mockQueue.getJobState.mockResolvedValue('unknown');

    const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

    expect(result.jobId).toBe('in-flight-job');
    expect(result.status).toBe(JobStatus.PENDING);
    expect(mockBackupRepository.markFailedIfUnfinished).not.toHaveBeenCalled();
    expect(mockBackupRepository.insertPendingOrFindExisting).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('createBackup gives up retrying after one dead-job replacement and returns the second coalesced ticket as-is', async () => {
    mockBackupRepository.insertPendingOrFindExisting.mockResolvedValue({
      created: false,
      job: {
        id: 'still-dead-job',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/still-dead.dump',
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    });
    mockQueue.getJobState.mockResolvedValue('unknown');

    const result = await service.createBackup({ connectionId: 'conn-1' }, mockUser);

    expect(mockBackupRepository.insertPendingOrFindExisting).toHaveBeenCalledTimes(2);
    expect(mockBackupRepository.markFailedIfUnfinished).toHaveBeenCalledTimes(1);
    expect(result.jobId).toBe('still-dead-job');
    expect(result.status).toBe(JobStatus.PENDING);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('createBackup enqueues a new PENDING job even when another job is currently RUNNING for the connection', async () => {
    mockBackupRepository.insertPendingOrFindExisting.mockResolvedValue({
      created: true,
      job: {
        id: 'new-job-456',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/new.dump',
      },
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

  describe('executeQueuedBackup manifest source snapshot (PostgreSQL)', () => {
    const tableRows = [{ name: 'public.users', estimated_rows: '10' }];

    // Answers each query the way the server does: `SHOW server_version` returns
    // a column named `server_version`, and the table statistics return their rows.
    const answerQueries = (versionRows: Array<{ server_version: string }>): void => {
      mockPgClient.query.mockImplementation((sql: string) =>
        Promise.resolve({ rows: sql.includes('SHOW server_version') ? versionRows : tableRows }),
      );
    };

    const uploadedManifest = async (): Promise<{
      source: { serverVersion: string; tableCount: number; estimatedRows: number };
    }> => {
      const body = mockR2Service.upload.mock.calls[0][1] as AsyncIterable<string>;
      let json = '';
      for await (const chunk of body) json += chunk;
      return JSON.parse(json);
    };

    beforeEach(() => {
      // Run the real snapshot capture against the fake pg client.
      captureSourceSnapshotSpy.mockRestore();
      mockPgClient.connect.mockResolvedValue(undefined);
      mockPgClient.end.mockResolvedValue(undefined);
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-snapshot',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/snapshot.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });
    });

    it('records the version the server reports in the manifest', async () => {
      answerQueries([{ server_version: '18.6 (Debian 18.6-1.pgdg13+1)' }]);

      const outcome = await service.executeQueuedBackup('job-snapshot');

      expect(outcome.kind).toBe('finished');
      expect(mockPgClient.query).toHaveBeenCalledWith('SHOW server_version');
      const manifest = await uploadedManifest();
      expect(manifest.source).toMatchObject({
        serverVersion: '18.6 (Debian 18.6-1.pgdg13+1)',
        tableCount: 1,
        estimatedRows: 10,
      });
    });

    it('falls back to "unknown" when the server returns no version row', async () => {
      answerQueries([]);

      const outcome = await service.executeQueuedBackup('job-snapshot');

      expect(outcome.kind).toBe('finished');
      const manifest = await uploadedManifest();
      expect(manifest.source.serverVersion).toBe('unknown');
    });

    describe('when the source database cannot be reached', () => {
      const reachableConnection = {
        ...mockConnection,
        host: 'db.internal',
        port: 5432,
        username: 'backup_user',
        password: 'hunter2-secret',
      };

      beforeEach(() => {
        mockConnectionsService.findById.mockResolvedValue(reachableConnection);
        mockPgClient.connect.mockRejectedValue(new Error('read ECONNRESET'));
      });

      it('records a failure that names the source stage and the connection, keeping the original cause', async () => {
        await expect(service.executeQueuedBackup('job-snapshot')).rejects.toThrow();

        const persisted = mockBackupRepository.failIfLeaseHeld.mock.calls[0][3] as string;
        expect(persisted).toBe(
          'No se pudo conectar a la base de origen "Prod DB": read ECONNRESET',
        );
        expect(persisted).not.toContain('hunter2-secret');
        expect(mockStrategy.execute).not.toHaveBeenCalled();
      });

      it('sends the same stage-prefixed reason in the failed SSE event', async () => {
        await expect(service.executeQueuedBackup('job-snapshot')).rejects.toThrow();

        expect(mockSseService.emit).toHaveBeenCalledWith('job-snapshot', {
          type: 'failed',
          payload: {
            jobId: 'job-snapshot',
            error: 'No se pudo conectar a la base de origen "Prod DB": read ECONNRESET',
          },
        });
      });

      it('names the snapshot stage when the connection opens but a statistics query fails', async () => {
        mockPgClient.connect.mockResolvedValue(undefined);
        mockPgClient.query.mockRejectedValue(new Error('permission denied for view pg_stat_user_tables'));

        await expect(service.executeQueuedBackup('job-snapshot')).rejects.toThrow();

        const persisted = mockBackupRepository.failIfLeaseHeld.mock.calls[0][3] as string;
        expect(persisted).toBe(
          'No se pudo capturar el snapshot de la base de origen "Prod DB": permission denied for view pg_stat_user_tables',
        );
      });
    });
  });

  it('executeQueuedBackup prefixes a manifest upload failure with the storage stage', async () => {
    mockBackupRepository.findById.mockResolvedValue({
      id: 'job-manifest',
      connectionId: 'conn-1',
      status: JobStatus.PENDING,
      fileKey: 'prod-db/manual/manifest.dump',
      category: BackupCategory.MANUAL,
      triggeredBy: mockUser.id,
    });
    mockR2Service.upload.mockRejectedValue(new Error('socket hang up'));

    await expect(service.executeQueuedBackup('job-manifest')).rejects.toThrow();

    expect(mockBackupRepository.failIfLeaseHeld).toHaveBeenCalledWith(
      'job-manifest',
      'conn-1',
      expect.any(String),
      'No se pudo subir el manifiesto al almacenamiento: socket hang up',
      expect.any(Date),
    );
    expect(mockR2Service.delete).toHaveBeenCalledWith('prod-db/manual/manifest.dump');
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

  describe('executeQueuedBackup failure while BullMQ still has attempts left', () => {
    beforeEach(() => {
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-attempts',
        connectionId: 'conn-1',
        status: JobStatus.PENDING,
        fileKey: 'prod-db/manual/attempts.dump',
        category: BackupCategory.MANUAL,
        triggeredBy: mockUser.id,
      });
      mockStrategy.execute.mockRejectedValue(new Error('pg_dump failed: connection reset'));
    });

    it('reports the failed attempt as a log line and keeps the stream open for the retry', async () => {
      await expect(
        service.executeQueuedBackup('job-attempts', { isRetry: false, attempt: 1, maxAttempts: 2 }),
      ).rejects.toThrow();

      expect(mockSseService.emit).toHaveBeenCalledWith('job-attempts', {
        type: 'log',
        payload: {
          message: 'Intento 1 de 2 falló: pg_dump failed: connection reset. Reintentando...',
          timestamp: expect.any(Date),
        },
      });
      expect(mockSseService.emit).not.toHaveBeenCalledWith(
        'job-attempts',
        expect.objectContaining({ type: 'failed' }),
      );
      expect(mockSseService.complete).not.toHaveBeenCalled();
    });

    it('tells the worker whether the rejection already closed the stream', async () => {
      const retried = await service
        .executeQueuedBackup('job-attempts', { isRetry: false, attempt: 1, maxAttempts: 2 })
        .catch((err: unknown) => err);
      const final = await service
        .executeQueuedBackup('job-attempts', { isRetry: true, attempt: 2, maxAttempts: 2 })
        .catch((err: unknown) => err);

      expect(isJobStreamClosed(retried)).toBe(false);
      expect(isJobStreamClosed(final)).toBe(true);
    });

    it('emits the terminal failed event and closes the stream on the last attempt', async () => {
      await expect(
        service.executeQueuedBackup('job-attempts', { isRetry: true, attempt: 2, maxAttempts: 2 }),
      ).rejects.toThrow();

      expect(mockSseService.emit).toHaveBeenCalledWith('job-attempts', {
        type: 'failed',
        payload: { jobId: 'job-attempts', error: 'pg_dump failed: connection reset' },
      });
      expect(mockSseService.complete).toHaveBeenCalledWith('job-attempts');
    });

    it('treats an UnrecoverableError raised mid-run as final even with attempts left', async () => {
      mockStrategy.execute.mockRejectedValue(new UnrecoverableError('dump file is corrupt'));

      await expect(
        service.executeQueuedBackup('job-attempts', { isRetry: false, attempt: 1, maxAttempts: 2 }),
      ).rejects.toThrow();

      expect(mockSseService.emit).toHaveBeenCalledWith(
        'job-attempts',
        expect.objectContaining({ type: 'failed' }),
      );
      expect(mockSseService.complete).toHaveBeenCalledWith('job-attempts');
    });
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

    it('cancels a RUNNING job with no local AbortController via a conditional update', async () => {
      // No `active.abort()` call exists on this replica for this job id: the
      // process actually running the dump (if any) is on another replica.
      mockBackupRepository.findById.mockResolvedValue({
        id: 'job-remote-running',
        connectionId: 'conn-1',
        status: JobStatus.RUNNING,
        fileKey: 'prod-db/manual/remote-running.dump',
      });
      mockBackupRepository.markFailedIfUnfinished.mockResolvedValue(true);

      const result = await service.cancelBackup('job-remote-running', mockUser);

      expect(mockBackupRepository.markFailedIfUnfinished).toHaveBeenCalledWith(
        'job-remote-running',
        'Operación cancelada por el usuario',
        expect.any(Date),
      );
      expect(mockBackupRepository.updateStatus).not.toHaveBeenCalled();
      expect(mockR2Service.delete).toHaveBeenCalledWith('prod-db/manual/remote-running.dump');
      expect(result.status).toBe(JobStatus.FAILED);
    });

    it('does not delete R2 or emit failed SSE when the job already reached a terminal state before the conditional cancel update landed', async () => {
      mockBackupRepository.findById
        .mockResolvedValueOnce({
          id: 'job-already-done',
          connectionId: 'conn-1',
          status: JobStatus.RUNNING,
          fileKey: 'prod-db/manual/already-done.dump',
        })
        .mockResolvedValueOnce({
          id: 'job-already-done',
          connectionId: 'conn-1',
          status: JobStatus.COMPLETED,
        });
      mockBackupRepository.markFailedIfUnfinished.mockResolvedValue(false);

      const result = await service.cancelBackup('job-already-done', mockUser);

      expect(mockR2Service.delete).not.toHaveBeenCalled();
      expect(mockSseService.emit).not.toHaveBeenCalledWith(
        'job-already-done',
        expect.objectContaining({ type: 'failed' }),
      );
      expect(result.status).toBe(JobStatus.COMPLETED);
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
