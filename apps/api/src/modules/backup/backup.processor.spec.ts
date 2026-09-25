/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { BackupProcessor } from './backup.processor';
import { BackupService } from './backup.service';
import { Job } from 'bullmq';

describe('BackupProcessor', () => {
  let processor: BackupProcessor;
  let mockBackupService: {
    executeQueuedBackup: jest.Mock;
  };

  beforeEach(async () => {
    mockBackupService = {
      executeQueuedBackup: jest.fn().mockResolvedValue({
        jobId: 'job-123',
        status: 'completed',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupProcessor,
        { provide: BackupService, useValue: mockBackupService },
      ],
    }).compile();

    processor = module.get<BackupProcessor>(BackupProcessor);
  });

  it('delegates execution of queued backup job to BackupService', async () => {
    const mockJob = {
      data: {
        jobId: 'job-123',
      },
    } as unknown as Job<{ jobId: string }>;

    await processor.process(mockJob);

    expect(mockBackupService.executeQueuedBackup).toHaveBeenCalledWith('job-123');
  });
});
