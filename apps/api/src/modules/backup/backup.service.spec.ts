/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConflictException } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';
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

  it('createBackup rejects with ConflictException if an active job already exists for connection', async () => {
    mockBackupRepository.findActiveJobForConnection.mockResolvedValue({
      id: 'active-job-999',
      status: JobStatus.RUNNING,
    });

    await expect(
      service.createBackup({ connectionId: 'conn-1' }, mockUser),
    ).rejects.toThrow(ConflictException);

    expect(mockQueue.add).not.toHaveBeenCalled();
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

    const result = await service.executeQueuedBackup('job-123');

    expect(result.sha256).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(result.bytes).toBe(13107200);
    expect(result.fileSizeMb).toBe(12.5);

    expect(mockR2Service.upload).toHaveBeenCalledTimes(1);
    const uploadedManifestKey = mockR2Service.upload.mock.calls[0][0];
    expect(uploadedManifestKey).toContain('.manifest.json');

    expect(mockBackupRepository.updateStatus).toHaveBeenCalledWith(
      'job-123',
      JobStatus.COMPLETED,
      expect.objectContaining({
        fileSizeMb: 12.5,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        bytes: 13107200,
      }),
    );
    expect(mockSseService.complete).toHaveBeenCalledWith('job-123');
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

    expect(mockBackupRepository.updateStatus).toHaveBeenCalledWith(
      'job-123',
      JobStatus.FAILED,
      expect.objectContaining({
        errorMessage: expect.stringContaining('pg_dump connection lost'),
      }),
    );
    expect(mockSseService.emit).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        type: 'failed',
      }),
    );
    expect(mockSseService.complete).toHaveBeenCalledWith('job-123');
  });
});
