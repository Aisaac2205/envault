/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';
import { R2Service } from './r2.service';
import { ConnectionsService } from '../connections/connections.service';
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
  };
  let mockR2Service: {
    upload: jest.Mock;
    delete: jest.Mock;
  };
  let mockConnectionsService: {
    findById: jest.Mock;
  };
  let mockStrategy: {
    execute: jest.Mock;
  };

  beforeEach(async () => {
    mockBackupRepository = {
      create: jest.fn(),
      updateStatus: jest.fn(),
    };
    mockR2Service = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    mockConnectionsService = {
      findById: jest.fn(),
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

  it('uploads manifest v2 and updates DB with sha256 and bytes upon completion', async () => {
    const mockConnection: Partial<ConnectionEntity> = {
      id: 'conn-1',
      name: 'Prod DB',
      slug: 'prod-db',
      environment: Environment.PROD,
      dbType: DbTypeEnum.POSTGRES,
      database: 'main',
    };
    mockConnectionsService.findById.mockResolvedValue(mockConnection);

    const mockJob: Partial<BackupJobEntity> = {
      id: 'job-123',
    };
    mockBackupRepository.create.mockResolvedValue(mockJob);

    const user = {
      id: 'user-1',
      email: 'admin@vaultly.local',
      name: 'Admin',
      role: 'admin',
    };

    const result = await service.createBackup(
      { connectionId: 'conn-1' },
      user,
      BackupCategory.MANUAL,
    );

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
  });
});
