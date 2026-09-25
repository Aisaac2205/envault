import { Test, TestingModule } from '@nestjs/testing';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { JobStatus } from '../../database/enums/job-status.enum';

jest.mock('../../auth/auth.guard', () => ({
  BetterAuthGuard: class {},
}));

describe('JobsController', () => {
  let controller: JobsController;
  let service: JobsService;

  const mockJobsService = {
    getBackupJobs: jest.fn().mockResolvedValue([]),
    getRestoreJobs: jest.fn().mockResolvedValue([]),
    getBackupJobById: jest.fn().mockResolvedValue({ id: 'backup-1' }),
    getRestoreJobById: jest.fn().mockResolvedValue({ id: 'restore-1' }),
    getSummary: jest.fn().mockResolvedValue({}),
    getStats: jest.fn().mockResolvedValue({}),
    getDailyCounts: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        {
          provide: JobsService,
          useValue: mockJobsService,
        },
      ],
    }).compile();

    controller = module.get<JobsController>(JobsController);
    service = module.get<JobsService>(JobsService);
    jest.clearAllMocks();
  });

  it('delegates getBackupJobs with ListJobsQueryDto directly to service', async () => {
    const query: ListJobsQueryDto = {
      status: JobStatus.COMPLETED,
      limit: 5,
    };

    const result = await controller.getBackupJobs(query);

    expect(result).toEqual([]);
    expect(service.getBackupJobs).toHaveBeenCalledWith(query);
  });

  it('delegates getRestoreJobs with ListJobsQueryDto directly to service', async () => {
    const query: ListJobsQueryDto = {
      status: JobStatus.PENDING,
      limit: 10,
    };

    const result = await controller.getRestoreJobs(query);

    expect(result).toEqual([]);
    expect(service.getRestoreJobs).toHaveBeenCalledWith(query);
  });
});
