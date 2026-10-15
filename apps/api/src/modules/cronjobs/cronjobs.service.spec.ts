/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
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

// update() and toggle() decide from what the repository returns whether the job
// stays in the live scheduler and which nextRunAt is stored. The repository
// answers with the whole stored row (or null when the row is gone); a real
// SchedulerRegistry shows what ends up scheduled.
describe('CronjobsService update and toggle', () => {
  let service: CronjobsService;
  let scheduler: SchedulerRegistry;
  let rows: Map<string, CronjobEntity>;
  let mockRepository: {
    findById: jest.Mock;
    update: jest.Mock;
    updateRunMetadata: jest.Mock;
  };

  const seed = (overrides: Partial<CronjobEntity> = {}): CronjobEntity => {
    const row = Object.assign(new CronjobEntity(), {
      id: 'cron-1',
      name: 'Nightly',
      connectionId: 'conn-1',
      // 1 January: never fires while the suite runs.
      cronExpression: '0 0 1 1 *',
      frequency: CronFrequency.CUSTOM,
      isActive: true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null,
      ...overrides,
    });
    rows.set(row.id, row);
    return row;
  };

  const nextFireOf = (expression: string): Date =>
    new CronJob(expression, () => undefined).nextDate().toJSDate();

  beforeEach(async () => {
    rows = new Map();
    scheduler = new SchedulerRegistry();
    mockRepository = {
      findById: jest.fn(async (id: string) => {
        const row = rows.get(id);
        return row ? Object.assign(new CronjobEntity(), row) : null;
      }),
      update: jest.fn(async (id: string, data: Partial<CronjobEntity>) => {
        const row = rows.get(id);
        if (!row) return null;
        const updated = Object.assign(new CronjobEntity(), row, data);
        rows.set(id, updated);
        return Object.assign(new CronjobEntity(), updated);
      }),
      updateRunMetadata: jest.fn(async (id: string, data: Partial<CronjobEntity>) => {
        const row = rows.get(id);
        if (row) Object.assign(row, data);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronjobsService,
        { provide: CronjobsRepository, useValue: mockRepository },
        { provide: SchedulerRegistry, useValue: scheduler },
        { provide: BackupService, useValue: {} },
        { provide: MaintenanceService, useValue: {} },
        { provide: ConnectionsService, useValue: { findByIds: jest.fn(async () => new Map()) } },
        { provide: getDataSourceToken(), useValue: {} },
      ],
    }).compile();

    service = module.get<CronjobsService>(CronjobsService);
  });

  afterEach(() => {
    for (const job of scheduler.getCronJobs().values()) {
      void job.stop();
    }
  });

  describe('update', () => {
    it('keeps an active cronjob scheduled and its nextRunAt after a rename', async () => {
      seed();

      const result = await service.update('cron-1', { name: 'Renamed' });

      expect(result).toMatchObject({ name: 'Renamed', isActive: true });
      expect(result.nextRunAt).toEqual(nextFireOf('0 0 1 1 *'));
      expect(scheduler.doesExist('cron', 'cron-1')).toBe(true);
      expect(rows.get('cron-1')?.nextRunAt).toEqual(nextFireOf('0 0 1 1 *'));
    });

    it('reschedules an active cronjob with the new expression', async () => {
      seed();

      const result = await service.update('cron-1', { cronExpression: '0 0 1 7 *' });

      expect(result.nextRunAt).toEqual(nextFireOf('0 0 1 7 *'));
      expect(scheduler.getCronJob('cron-1').nextDate().toJSDate()).toEqual(nextFireOf('0 0 1 7 *'));
      expect(rows.get('cron-1')?.nextRunAt).toEqual(nextFireOf('0 0 1 7 *'));
    });

    it('leaves an inactive cronjob unscheduled with no nextRunAt', async () => {
      seed({ isActive: false });

      const result = await service.update('cron-1', { name: 'Renamed' });

      expect(result).toMatchObject({ name: 'Renamed', isActive: false, nextRunAt: null });
      expect(scheduler.doesExist('cron', 'cron-1')).toBe(false);
    });

    it('answers 404 when the cronjob disappears before the update is saved', async () => {
      seed();
      mockRepository.update.mockResolvedValueOnce(null);

      await expect(service.update('cron-1', { name: 'Renamed' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('toggle', () => {
    it('schedules a paused cronjob when it is switched on', async () => {
      seed({ isActive: false });

      const result = await service.toggle('cron-1');

      expect(result).toMatchObject({ isActive: true, name: 'Nightly' });
      expect(result.nextRunAt).toEqual(nextFireOf('0 0 1 1 *'));
      expect(scheduler.doesExist('cron', 'cron-1')).toBe(true);
    });

    it('unschedules an active cronjob when it is switched off', async () => {
      seed();
      await service.update('cron-1', { name: 'Nightly' });

      const result = await service.toggle('cron-1');

      expect(result).toMatchObject({ isActive: false, nextRunAt: null });
      expect(scheduler.doesExist('cron', 'cron-1')).toBe(false);
    });

    it('answers 404 when the cronjob disappears before the toggle is saved', async () => {
      seed();
      mockRepository.update.mockResolvedValueOnce(null);

      await expect(service.toggle('cron-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
