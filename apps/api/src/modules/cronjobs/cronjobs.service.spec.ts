/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronjobsService } from './cronjobs.service';
import { CronjobsRepository } from './cronjobs.repository';
import { BackupService } from '../backup/backup.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { ConnectionsService } from '../connections/connections.service';
import { CronjobEntity } from '../../database/entities/cronjob.entity';
import { CronFrequency } from '../../database/enums/cron-frequency.enum';
import { JobStatus } from '../../database/enums/job-status.enum';

describe('CronjobsService Watchdog', () => {
  let service: CronjobsService;
  let mockRepository: {
    findAllActive: jest.Mock;
    resetStaleRunning: jest.Mock;
    updateRunMetadata: jest.Mock;
  };

  beforeEach(async () => {
    mockRepository = {
      findAllActive: jest.fn(),
      resetStaleRunning: jest.fn(),
      updateRunMetadata: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronjobsService,
        { provide: CronjobsRepository, useValue: mockRepository },
        { provide: SchedulerRegistry, useValue: {} },
        { provide: BackupService, useValue: {} },
        { provide: MaintenanceService, useValue: {} },
        { provide: ConnectionsService, useValue: {} },
        { provide: getDataSourceToken(), useValue: {} },
      ],
    }).compile();

    service = module.get<CronjobsService>(CronjobsService);
  });

  it('detects and alerts for overdue cronjobs that missed their execution period', async () => {
    const overdueCronjob: Partial<CronjobEntity> = {
      id: 'cron-1',
      name: 'Hourly Backup',
      frequency: CronFrequency.HOURLY,
      lastStatus: JobStatus.COMPLETED,
      lastRunAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000),
      nextRunAt: new Date(Date.now() - 30 * 60 * 1000),
    };

    mockRepository.findAllActive.mockResolvedValue([overdueCronjob]);
    jest
      .spyOn(
        service as unknown as { catchUpIfMissed: (cronjob: unknown) => void },
        'catchUpIfMissed',
      )
      .mockImplementation(() => undefined);


    const overdueCount = await service.checkWatchdog();

    expect(overdueCount).toBe(1);
  });

  it('returns 0 when active cronjobs are within their period', async () => {
    const healthyCronjob: Partial<CronjobEntity> = {
      id: 'cron-2',
      name: 'Healthy Hourly',
      frequency: CronFrequency.HOURLY,
      lastStatus: JobStatus.COMPLETED,
      lastRunAt: new Date(Date.now() - 10 * 60 * 1000),
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      nextRunAt: new Date(Date.now() + 50 * 60 * 1000),
    };

    mockRepository.findAllActive.mockResolvedValue([healthyCronjob]);

    const overdueCount = await service.checkWatchdog();

    expect(overdueCount).toBe(0);
  });
});
