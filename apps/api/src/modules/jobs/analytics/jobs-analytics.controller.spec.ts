import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JobsAnalyticsController } from './jobs-analytics.controller';
import { JobsAnalyticsService } from './jobs-analytics.service';
import { ROLES_KEY } from '../../../auth/roles.guard';

jest.mock('../../../auth/auth.guard', () => ({
  BetterAuthGuard: class {},
}));

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

  it('requires the admin role via class-level @Roles metadata', () => {
    const roles = reflector.get<string[]>(ROLES_KEY, JobsAnalyticsController);
    expect(roles).toEqual(['admin']);
  });

  it('applies BetterAuthGuard and RolesGuard at the class level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, JobsAnalyticsController);
    expect(guards).toHaveLength(2);
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
