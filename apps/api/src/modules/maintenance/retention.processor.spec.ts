import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { RetentionProcessor, RetentionJobPayload } from './retention.processor';
import { MaintenanceService } from './maintenance.service';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { RETENTION_JOB_NAME } from './maintenance.constants';

describe('RetentionProcessor', () => {
  let processor: RetentionProcessor;

  const mockMaintenanceService = {
    applyRetention: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionProcessor,
        { provide: MaintenanceService, useValue: mockMaintenanceService },
      ],
    }).compile();

    processor = module.get<RetentionProcessor>(RetentionProcessor);
  });

  it('delegates to maintenanceService.applyRetention when job name matches', async () => {
    mockMaintenanceService.applyRetention.mockResolvedValue({
      deleted: 2,
      freedMb: 100,
      errors: [],
    });

    const job = {
      id: 'job-1',
      name: RETENTION_JOB_NAME,
      data: {
        connectionSlug: 'finance-db',
        category: BackupCategory.DAILY,
        policy: { maxAgeDays: 14 },
      },
    } as Job<RetentionJobPayload>;

    const result = await processor.process(job);

    expect(result).toEqual({ deleted: 2, freedMb: 100, errors: [] });
    expect(mockMaintenanceService.applyRetention).toHaveBeenCalledWith(
      'finance-db',
      BackupCategory.DAILY,
      { maxAgeDays: 14 },
    );
  });

  it('returns undefined when job name does not match', async () => {
    const job = {
      id: 'job-2',
      name: 'unknown-job',
      data: {
        connectionSlug: 'finance-db',
        category: BackupCategory.DAILY,
        policy: { maxAgeDays: 14 },
      },
    } as Job<RetentionJobPayload>;

    const result = await processor.process(job);

    expect(result).toBeUndefined();
    expect(mockMaintenanceService.applyRetention).not.toHaveBeenCalled();
  });
});
