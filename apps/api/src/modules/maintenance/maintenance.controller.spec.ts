import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { BackupCategory } from '../../database/enums/backup-category.enum';

jest.mock('../../auth/auth.guard', () => ({
  BetterAuthGuard: class {},
}));
jest.mock('../../auth/roles.guard', () => ({
  RolesGuard: class {},
  Roles: () => () => {},
}));

describe('MaintenanceController', () => {
  let controller: MaintenanceController;

  const mockMaintenanceService = {
    previewCleanup: jest.fn(),
    runCleanup: jest.fn(),
    getStorageOverview: jest.fn(),
    previewDbHygiene: jest.fn(),
    runDbHygiene: jest.fn(),
    reconcilePreview: jest.fn(),
    reconcileRun: jest.fn(),
    getManualRetention: jest.fn(),
    updateManualRetention: jest.fn(),
    getRetentionPolicies: jest.fn(),
    updateRetentionPolicies: jest.fn(),
    previewRetentionForConnection: jest.fn(),
    runRetentionForConnection: jest.fn(),
  };

  const createMockRequest = (): Request =>
    ({
      headers: {},
      rawHeaders: [],
      body: {},
      params: {},
      query: {},
    }) as unknown as Request;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MaintenanceController],
      providers: [
        { provide: MaintenanceService, useValue: mockMaintenanceService },
      ],
    }).compile();

    controller = module.get<MaintenanceController>(MaintenanceController);
  });

  it('previewCleanup returns enriched dry-run simulation', async () => {
    const expected = {
      items: [],
      count: 2,
      totalBytes: 25000000,
      totalSizeMb: 23.84,
      protectedCount: 1,
      candidates: [
        {
          fileKey: 'db/manual/d1.dump',
          sizeBytes: 15000000,
          lastModified: '2026-09-20T00:00:00.000Z',
          category: BackupCategory.MANUAL,
          reason: 'exceeds_max_age',
          jobId: 'job-1',
          isProtected: false,
        },
      ],
    };
    mockMaintenanceService.previewCleanup.mockResolvedValue(expected);

    const query = {
      connectionSlug: 'db',
      category: BackupCategory.MANUAL,
      maxAgeDays: 30,
    };
    const result = await controller.previewCleanup(query);

    expect(result).toEqual(expected);
    expect(mockMaintenanceService.previewCleanup).toHaveBeenCalledWith(query);
  });

  it('runCleanup executes coordinated purge and records audit context', async () => {
    mockMaintenanceService.runCleanup.mockResolvedValue({
      deleted: 1,
      freedMb: 15,
      errors: [],
    });

    const req = createMockRequest();
    const dto = {
      connectionSlug: 'db',
      category: BackupCategory.MANUAL,
      maxAgeDays: 30,
    };
    const result = await controller.runCleanup(dto, req);

    expect(result).toEqual({ deleted: 1, freedMb: 15, errors: [] });
    expect(mockMaintenanceService.runCleanup).toHaveBeenCalledWith(dto);
  });

  it('previewRetentionForConnection returns per-policy dry-run previews', async () => {
    const expected = [
      {
        category: BackupCategory.DAILY,
        count: 1,
        totalBytes: 10485760,
        totalSizeMb: 10,
        protectedCount: 1,
        candidates: [],
      },
    ];
    mockMaintenanceService.previewRetentionForConnection.mockResolvedValue(expected);

    const result = await controller.previewRetentionForConnection('app-db');

    expect(result).toEqual(expected);
    expect(mockMaintenanceService.previewRetentionForConnection).toHaveBeenCalledWith('app-db');
  });

  it('runRetentionForConnection runs coordinated retention and sets audit metadata', async () => {
    mockMaintenanceService.runRetentionForConnection.mockResolvedValue([
      { category: BackupCategory.DAILY, deleted: 1, freedMb: 10, errors: 0 },
    ]);

    const req = createMockRequest();
    const result = await controller.runRetentionForConnection('app-db', req);

    expect(result).toEqual([
      { category: BackupCategory.DAILY, deleted: 1, freedMb: 10, errors: 0 },
    ]);
    expect(mockMaintenanceService.runRetentionForConnection).toHaveBeenCalledWith('app-db');
  });
});
