/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { RestoreProcessor, RestoreJobPayload } from './restore.processor';
import { RestoreService } from './restore.service';
import { Job } from 'bullmq';

describe('RestoreProcessor', () => {
  let processor: RestoreProcessor;
  let mockRestoreService: {
    executeRestoreAsync: jest.Mock;
  };

  beforeEach(async () => {
    mockRestoreService = {
      executeRestoreAsync: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreProcessor,
        { provide: RestoreService, useValue: mockRestoreService },
      ],
    }).compile();

    processor = module.get<RestoreProcessor>(RestoreProcessor);
  });

  it('delegates execution of queued restore job to RestoreService', async () => {
    const mockPayload: RestoreJobPayload = {
      jobId: 'restore-123',
      dto: {
        targetConnectionId: 'conn-1',
        sourceBackupId: 'backup-1',
        isDryRun: false,
      },
      user: {
        id: 'user-1',
        email: 'admin@envault.dev',
        name: 'Admin',
        role: 'admin',
      },
      leaseToken: 'lease-token-123',
    };

    const mockJob = {
      data: mockPayload,
    } as unknown as Job<RestoreJobPayload>;

    await processor.process(mockJob);

    expect(mockRestoreService.executeRestoreAsync).toHaveBeenCalledWith(
      'restore-123',
      mockPayload.dto,
      mockPayload.user,
      'lease-token-123',
    );
  });
});
