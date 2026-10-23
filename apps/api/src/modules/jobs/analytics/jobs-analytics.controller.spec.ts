import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JobsAnalyticsController } from './jobs-analytics.controller';
import { JobsAnalyticsService } from './jobs-analytics.service';
import { PERMISSION_KEY, PUBLIC_KEY } from '../../../common/authorization';

describe('JobsAnalyticsController', () => {
  let controller: JobsAnalyticsController;
  let service: JobsAnalyticsService;
  let reflector: Reflector;

  const mockService = {
    getDailySeries: jest.fn().mockResolvedValue({ window: 30, days: [] }),
    getStorageByConnection: jest.fn().mockResolvedValue([]),
    getRestoreStatusCounts: jest.fn().mockResolvedValue({
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      total: 0,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobsAnalyticsController],
      providers: [
        { provide: JobsAnalyticsService, useValue: mockService },
        Reflector,
      ],
    }).compile();

    controller = module.get<JobsAnalyticsController>(JobsAnalyticsController);
    service = module.get<JobsAnalyticsService>(JobsAnalyticsService);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  it('delegates the daily route to service.getDailySeries with the parsed window', async () => {
    const result = await controller.getDailySeries({ window: 7 });

    expect(result).toEqual({ window: 30, days: [] });
    expect(service.getDailySeries).toHaveBeenCalledWith(7);
  });

  it('delegates the daily route with undefined window when omitted', async () => {
    await controller.getDailySeries({});

    expect(service.getDailySeries).toHaveBeenCalledWith(undefined);
  });

  it('belongs to the dashboard feature via class-level @RequirePermission metadata', () => {
    const feature = reflector.get<string>(PERMISSION_KEY, JobsAnalyticsController);
    expect(feature).toBe('dashboard');
  });

  it('stays behind the global guards (it is not opted out as public)', () => {
    expect(reflector.get<boolean>(PUBLIC_KEY, JobsAnalyticsController)).toBeUndefined();
  });

  it('delegates the storage-by-connection route directly to the service', async () => {
    const result = await controller.getStorageByConnection();

    expect(result).toEqual([]);
    expect(service.getStorageByConnection).toHaveBeenCalledWith();
  });

  it('delegates the restore-status route directly to the service', async () => {
    const result = await controller.getRestoreStatusCounts();

    expect(result).toEqual({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 });
    expect(service.getRestoreStatusCounts).toHaveBeenCalledWith();
  });
});
