/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
import { ScheduleInputDto } from './dto/schedule.dto';

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
// SchedulerRegistry shows what ends up scheduled. create() and update() also
// resolve a structured `schedule` (or the legacy cronExpression) into what is
// stored, and every response path carries the `schedule` read back from it.
describe('CronjobsService update and toggle', () => {
  let service: CronjobsService;
  let scheduler: SchedulerRegistry;
  let rows: Map<string, CronjobEntity>;
  let mockRepository: {
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateRunMetadata: jest.Mock;
    upsertForConnection: jest.Mock;
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
      findAll: jest.fn(async () =>
        [...rows.values()].map((row) => Object.assign(new CronjobEntity(), row)),
      ),
      findById: jest.fn(async (id: string) => {
        const row = rows.get(id);
        return row ? Object.assign(new CronjobEntity(), row) : null;
      }),
      create: jest.fn(async (data: Partial<CronjobEntity>) => {
        const created = Object.assign(new CronjobEntity(), {
          id: 'cron-new',
          isActive: true,
          lastRunAt: null,
          nextRunAt: null,
          lastStatus: null,
          ...data,
        });
        rows.set(created.id, created);
        return Object.assign(new CronjobEntity(), created);
      }),
      upsertForConnection: jest.fn(async (connectionId: string, data: Partial<CronjobEntity>) => {
        const upserted = Object.assign(new CronjobEntity(), { id: 'cron-up', connectionId, ...data });
        rows.set(upserted.id, upserted);
        return Object.assign(new CronjobEntity(), upserted);
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

  describe('update with a schedule', () => {
    it('stores the expression and frequency derived from the schedule and reschedules', async () => {
      seed();

      const result = await service.update('cron-1', {
        schedule: { kind: 'monthly', time: '03:00', dayOfMonth: 1 },
      });

      expect(mockRepository.update).toHaveBeenCalledWith('cron-1', {
        cronExpression: '0 3 1 * *',
        frequency: CronFrequency.CUSTOM,
      });
      expect(result).toMatchObject({
        cronExpression: '0 3 1 * *',
        frequency: CronFrequency.CUSTOM,
      });
      expect(result.nextRunAt).toEqual(nextFireOf('0 3 1 * *'));
      expect(scheduler.getCronJob('cron-1').nextDate().toJSDate()).toEqual(
        nextFireOf('0 3 1 * *'),
      );
    });

    it('rejects a schedule together with a cronExpression with 400', async () => {
      seed();

      await expect(
        service.update('cron-1', {
          schedule: { kind: 'daily', time: '02:00' },
          cronExpression: '0 2 * * *',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a schedule together with a frequency with 400', async () => {
      seed();

      await expect(
        service.update('cron-1', {
          schedule: { kind: 'daily', time: '02:00' },
          frequency: CronFrequency.DAILY,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('leaves the expression and frequency alone when the request names no schedule', async () => {
      seed();

      await service.update('cron-1', { name: 'Renamed' });

      expect(Object.keys(mockRepository.update.mock.calls[0][1])).toEqual(['name']);
    });

    it('keeps a legacy cronExpression update working as before', async () => {
      seed();

      const result = await service.update('cron-1', { cronExpression: '0 5 * * *' });

      expect(Object.keys(mockRepository.update.mock.calls[0][1])).toEqual(['cronExpression']);
      expect(result).toMatchObject({ cronExpression: '0 5 * * *', frequency: CronFrequency.CUSTOM });
    });

    it('keeps a legacy frequency-only update working as before', async () => {
      seed();

      await service.update('cron-1', { frequency: CronFrequency.WEEKLY });

      expect(Object.keys(mockRepository.update.mock.calls[0][1])).toEqual(['frequency']);
    });

    it('still rejects an invalid legacy cronExpression with 400', async () => {
      seed();

      await expect(service.update('cron-1', { cronExpression: 'every day' })).rejects.toThrow(
        /Expresión cron inválida/,
      );
      expect(mockRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const base = { name: 'Nightly', connectionId: 'conn-1' };

    it.each<[string, ScheduleInputDto, string, CronFrequency]>([
      ['every hour', { kind: 'every_hours', everyHours: 1 }, '0 * * * *', CronFrequency.HOURLY],
      ['every 4 hours', { kind: 'every_hours', everyHours: 4 }, '0 */4 * * *', CronFrequency.CUSTOM],
      ['daily at 02:00', { kind: 'daily', time: '02:00' }, '0 2 * * *', CronFrequency.DAILY],
      [
        'weekly on one day',
        { kind: 'weekly', time: '02:00', daysOfWeek: [1] },
        '0 2 * * 1',
        CronFrequency.WEEKLY,
      ],
      [
        'weekly on several days',
        { kind: 'weekly', time: '06:30', daysOfWeek: [5, 1, 3] },
        '30 6 * * 1,3,5',
        CronFrequency.CUSTOM,
      ],
      [
        'monthly on day 15',
        { kind: 'monthly', time: '23:45', dayOfMonth: 15 },
        '45 23 15 * *',
        CronFrequency.CUSTOM,
      ],
    ])('stores %s with the derived expression and frequency', async (_label, schedule, expression, frequency) => {
      const result = await service.create({ ...base, schedule });

      expect(mockRepository.create).toHaveBeenCalledWith({
        ...base,
        cronExpression: expression,
        frequency,
      });
      expect(result).toMatchObject({ cronExpression: expression, frequency });
    });

    it('does not store the schedule object itself', async () => {
      await service.create({ ...base, schedule: { kind: 'daily', time: '02:00' } });

      expect(mockRepository.create.mock.calls[0][0]).not.toHaveProperty('schedule');
    });

    it('passes the retention fields through next to a schedule', async () => {
      await service.create({
        ...base,
        schedule: { kind: 'daily', time: '02:00' },
        retentionEnabled: true,
        retentionKeepLast: 5,
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ retentionEnabled: true, retentionKeepLast: 5 }),
      );
    });

    it('schedules the new cronjob and stores its nextRunAt', async () => {
      const result = await service.create({ ...base, schedule: { kind: 'daily', time: '02:00' } });

      expect(scheduler.doesExist('cron', 'cron-new')).toBe(true);
      expect(result.nextRunAt).toEqual(nextFireOf('0 2 * * *'));
    });

    it('keeps a legacy cronExpression and frequency working as before', async () => {
      const result = await service.create({
        ...base,
        cronExpression: '0 2 * * *',
        frequency: CronFrequency.WEEKLY,
      });

      expect(mockRepository.create).toHaveBeenCalledWith({
        ...base,
        cronExpression: '0 2 * * *',
        frequency: CronFrequency.WEEKLY,
      });
      expect(result).toMatchObject({ cronExpression: '0 2 * * *', frequency: CronFrequency.WEEKLY });
      expect(scheduler.doesExist('cron', 'cron-new')).toBe(true);
    });

    it.each([
      [
        'a schedule together with a cronExpression',
        { schedule: { kind: 'daily', time: '02:00' } as const, cronExpression: '0 2 * * *' },
      ],
      [
        'a schedule together with a frequency',
        { schedule: { kind: 'daily', time: '02:00' } as const, frequency: CronFrequency.DAILY },
      ],
      [
        'a schedule together with both legacy fields',
        {
          schedule: { kind: 'daily', time: '02:00' } as const,
          cronExpression: '0 2 * * *',
          frequency: CronFrequency.DAILY,
        },
      ],
      ['neither a schedule nor a cronExpression', {}],
      ['a cronExpression without a frequency', { cronExpression: '0 2 * * *' }],
      ['a frequency without a cronExpression', { frequency: CronFrequency.DAILY }],
    ])('rejects %s with 400', async (_label, fields) => {
      await expect(service.create({ ...base, ...fields })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('still rejects an invalid legacy cronExpression with 400', async () => {
      await expect(
        service.create({ ...base, cronExpression: 'every day', frequency: CronFrequency.DAILY }),
      ).rejects.toThrow(/Expresión cron inválida/);
      expect(mockRepository.create).not.toHaveBeenCalled();
    });
  });

  // The schedule is read back from the stored expression in one place, so every
  // path that answers with a cronjob agrees. `0 2 * * 1` is representable;
  // `*/7 3-5 * * 2,4` is the kind of legacy expression that is not.
  describe('schedule in responses', () => {
    const weekly = { kind: 'weekly', time: '02:00', daysOfWeek: [1] };

    it('findAll adds it to every cronjob, null when the expression is not representable', async () => {
      seed({ id: 'cron-1', cronExpression: '0 2 * * 1' });
      seed({ id: 'cron-2', cronExpression: '*/7 3-5 * * 2,4' });

      const result = await service.findAll();

      expect(result.map(({ id, cronExpression, schedule }) => ({ id, cronExpression, schedule })))
        .toEqual([
          { id: 'cron-1', cronExpression: '0 2 * * 1', schedule: weekly },
          { id: 'cron-2', cronExpression: '*/7 3-5 * * 2,4', schedule: null },
        ]);
    });

    it('findById adds it', async () => {
      seed({ cronExpression: '0 2 * * 1' });

      await expect(service.findById('cron-1')).resolves.toMatchObject({ schedule: weekly });
    });

    it('findById answers null for an expression that is not representable', async () => {
      seed({ cronExpression: '*/7 3-5 * * 2,4' });

      await expect(service.findById('cron-1')).resolves.toMatchObject({
        cronExpression: '*/7 3-5 * * 2,4',
        schedule: null,
      });
    });

    it('create adds it', async () => {
      const result = await service.create({
        name: 'Weekly',
        connectionId: 'conn-1',
        schedule: { kind: 'weekly', time: '02:00', daysOfWeek: [1] },
      });

      expect(result).toMatchObject({ cronExpression: '0 2 * * 1', schedule: weekly });
    });

    it('update adds it, read back from the new expression', async () => {
      seed();

      const result = await service.update('cron-1', { cronExpression: '0 2 * * 1' });

      expect(result).toMatchObject({ schedule: weekly });
    });

    it('toggle adds it', async () => {
      seed({ isActive: false, cronExpression: '0 2 * * 1' });

      await expect(service.toggle('cron-1')).resolves.toMatchObject({ schedule: weekly });
    });

    it('upsertSchedule adds it and keeps storing what it is given', async () => {
      const result = await service.upsertSchedule(
        'conn-1',
        '0 2 * * 1',
        'Backup automático',
        CronFrequency.WEEKLY,
      );

      expect(mockRepository.upsertForConnection).toHaveBeenCalledWith('conn-1', {
        name: 'Backup automático',
        cronExpression: '0 2 * * 1',
        frequency: CronFrequency.WEEKLY,
        isActive: true,
      });
      expect(result).toMatchObject({ cronExpression: '0 2 * * 1', schedule: weekly });
    });
  });
});
