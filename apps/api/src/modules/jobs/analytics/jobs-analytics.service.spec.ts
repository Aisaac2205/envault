import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobsAnalyticsService } from './jobs-analytics.service';
import { JobsAnalyticsRepository } from './jobs-analytics.repository';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

describe('JobsAnalyticsService', () => {
  let service: JobsAnalyticsService;
  let repository: {
    getDailyBackupRows: jest.Mock;
    getStorageByConnection: jest.Mock;
    countRestoreJobsByStatus: jest.Mock;
  };
  let connectionRepository: { findBy: jest.Mock };

  beforeEach(async () => {
    repository = {
      getDailyBackupRows: jest.fn().mockResolvedValue([]),
      getStorageByConnection: jest.fn().mockResolvedValue([]),
      countRestoreJobsByStatus: jest.fn().mockResolvedValue([]),
    };
    connectionRepository = {
      findBy: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsAnalyticsService,
        { provide: JobsAnalyticsRepository, useValue: repository },
        { provide: getRepositoryToken(ConnectionEntity), useValue: connectionRepository },
      ],
    }).compile();

    service = module.get<JobsAnalyticsService>(JobsAnalyticsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getDailySeries', () => {
    it('calls the repository with the correct from/toExclusive bounds for the requested window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00.000Z'));

      await service.getDailySeries(7);

      expect(repository.getDailyBackupRows).toHaveBeenCalledWith({
        from: '2026-03-09',
        toExclusive: '2026-03-16',
      });
    });

    it('returns the envelope shape with window, from, to, timezone and zero-filled days', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
      repository.getDailyBackupRows.mockResolvedValue([]);

      const result = await service.getDailySeries(7);

      expect(result).toEqual({
        window: 7,
        from: '2026-03-04',
        to: '2026-03-10',
        timezone: 'UTC',
        days: [
          { date: '2026-03-04', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
          { date: '2026-03-05', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
          { date: '2026-03-06', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
          { date: '2026-03-07', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
          { date: '2026-03-08', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
          { date: '2026-03-09', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
          { date: '2026-03-10', completed: 0, failed: 0, p50DurationSeconds: null, p95DurationSeconds: null, totalSizeMb: 0 },
        ],
      });
    });

    it('defaults to a 30-day window when none is provided', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T00:00:00.000Z'));

      const result = await service.getDailySeries();

      expect(repository.getDailyBackupRows).toHaveBeenCalledWith({
        from: '2026-02-14',
        toExclusive: '2026-03-16',
      });
      expect(result.window).toBe(30);
      expect(result.days).toHaveLength(30);
    });

    it('maps repository rows into the returned days by date', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
      repository.getDailyBackupRows.mockResolvedValue([
        { date: '2026-03-10', completed: '2', failed: '1', p50: 20, p95: 30, totalSizeMb: 40 },
      ]);

      const result = await service.getDailySeries(7);
      const today = result.days.find((d: { date: string }) => d.date === '2026-03-10');

      expect(today).toEqual({
        date: '2026-03-10',
        completed: 2,
        failed: 1,
        p50DurationSeconds: 20,
        p95DurationSeconds: 30,
        totalSizeMb: 40,
      });
    });
  });

  describe('getStorageByConnection', () => {
    it('sorts results by totalSizeMb descending, resolving names from ConnectionEntity', async () => {
      repository.getStorageByConnection.mockResolvedValue([
        { connectionId: 'conn-a', totalSizeMb: 300, backupCount: '2' },
        { connectionId: 'conn-b', totalSizeMb: 150, backupCount: '1' },
      ]);
      connectionRepository.findBy.mockResolvedValue([
        { id: 'conn-a', name: 'Prod DB' },
        { id: 'conn-b', name: 'Staging DB' },
      ]);

      const result = await service.getStorageByConnection();

      expect(result).toEqual([
        { connectionId: 'conn-a', connectionName: 'Prod DB', totalSizeMb: 300, backupCount: 2 },
        { connectionId: 'conn-b', connectionName: 'Staging DB', totalSizeMb: 150, backupCount: 1 },
      ]);
    });

    it('returns connectionName null when the connection no longer exists', async () => {
      repository.getStorageByConnection.mockResolvedValue([
        { connectionId: 'conn-deleted', totalSizeMb: 50, backupCount: '3' },
      ]);
      connectionRepository.findBy.mockResolvedValue([]);

      const result = await service.getStorageByConnection();

      expect(result).toEqual([
        { connectionId: 'conn-deleted', connectionName: null, totalSizeMb: 50, backupCount: 3 },
      ]);
    });
  });

  describe('getRestoreStatusCounts', () => {
    it('defaults missing statuses to zero and sums total from present ones', async () => {
      repository.countRestoreJobsByStatus.mockResolvedValue([
        { status: 'pending', count: '2' },
        { status: 'completed', count: '5' },
      ]);

      const result = await service.getRestoreStatusCounts();

      expect(result).toEqual({ pending: 2, running: 0, completed: 5, failed: 0, total: 7 });
    });

    it('returns all zeros and total zero when there are no restore jobs at all', async () => {
      repository.countRestoreJobsByStatus.mockResolvedValue([]);

      const result = await service.getRestoreStatusCounts();

      expect(result).toEqual({ pending: 0, running: 0, completed: 0, failed: 0, total: 0 });
    });
  });
});
