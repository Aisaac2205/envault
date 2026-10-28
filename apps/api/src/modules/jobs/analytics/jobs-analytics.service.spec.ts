import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobsAnalyticsService } from './jobs-analytics.service';
import { JobsAnalyticsRepository } from './jobs-analytics.repository';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

describe('JobsAnalyticsService', () => {
  let service: JobsAnalyticsService;
  let repository: {
    getDailyBackupRows: jest.Mock;
    getWindowStatsRows: jest.Mock;
    findActiveProdConnections: jest.Mock;
    getLatestBackups: jest.Mock;
    findActiveSchedules: jest.Mock;
    getStorageByConnection: jest.Mock;
    countRestoreJobsByStatus: jest.Mock;
  };
  let connectionRepository: { findBy: jest.Mock };

  beforeEach(async () => {
    repository = {
      getDailyBackupRows: jest.fn().mockResolvedValue([]),
      getWindowStatsRows: jest.fn().mockResolvedValue([]),
      findActiveProdConnections: jest.fn().mockResolvedValue([]),
      getLatestBackups: jest.fn().mockResolvedValue([]),
      findActiveSchedules: jest.fn().mockResolvedValue([]),
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
    const CONNECTION_ID = '6c1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

    const emptyDay = (date: string) => ({
      date,
      completed: 0,
      failed: 0,
      p50DurationSeconds: null,
      p95DurationSeconds: null,
      maxDurationSeconds: null,
      totalSizeMb: 0,
    });

    it('calls the repository with the correct from/toExclusive bounds for the requested window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00.000Z'));

      await service.getDailySeries(7);

      expect(repository.getDailyBackupRows).toHaveBeenCalledWith({
        from: '2026-03-09',
        toExclusive: '2026-03-16',
        connectionId: null,
      });
    });

    it('returns the envelope shape with window, from, to, timezone, connectionId and zero-filled days', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
      repository.getDailyBackupRows.mockResolvedValue([]);

      const result = await service.getDailySeries(7);

      expect(result).toEqual({
        window: 7,
        from: '2026-03-04',
        to: '2026-03-10',
        timezone: 'UTC',
        connectionId: null,
        days: ['2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'].map(
          emptyDay,
        ),
      });
    });

    it('defaults to a 30-day window when none is provided', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T00:00:00.000Z'));

      const result = await service.getDailySeries();

      expect(repository.getDailyBackupRows).toHaveBeenCalledWith({
        from: '2026-02-14',
        toExclusive: '2026-03-16',
        connectionId: null,
      });
      expect(result.window).toBe(30);
      expect(result.days).toHaveLength(30);
    });

    it('scopes the repository query to the given connectionId and echoes it in the series', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00.000Z'));

      const result = await service.getDailySeries(7, CONNECTION_ID);

      expect(repository.getDailyBackupRows).toHaveBeenCalledWith({
        from: '2026-03-09',
        toExclusive: '2026-03-16',
        connectionId: CONNECTION_ID,
      });
      expect(result.connectionId).toBe(CONNECTION_ID);
    });

    it('applies the default window when only a connectionId is given', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T00:00:00.000Z'));

      const result = await service.getDailySeries(undefined, CONNECTION_ID);

      expect(repository.getDailyBackupRows).toHaveBeenCalledWith({
        from: '2026-02-14',
        toExclusive: '2026-03-16',
        connectionId: CONNECTION_ID,
      });
      expect(result.window).toBe(30);
      expect(result.connectionId).toBe(CONNECTION_ID);
    });

    it('maps repository rows into the returned days by date', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
      repository.getDailyBackupRows.mockResolvedValue([
        { date: '2026-03-10', completed: '2', failed: '1', p50: 20, p95: 30, max: 32.04, totalSizeMb: 40 },
      ]);

      const result = await service.getDailySeries(7);
      const today = result.days.find((d: { date: string }) => d.date === '2026-03-10');

      expect(today).toEqual({
        date: '2026-03-10',
        completed: 2,
        failed: 1,
        p50DurationSeconds: 20,
        p95DurationSeconds: 30,
        maxDurationSeconds: 32,
        totalSizeMb: 40,
      });
    });
  });

  describe('getConnectionsHealth', () => {
    const NOW = new Date('2026-03-15T12:00:00.000Z');
    const HOURLY = '0 * * * *';
    const DAILY = '30 2 * * *';

    const connection = (connectionId: string, connectionName: string) => ({
      connectionId,
      connectionName,
      environment: 'prod',
      dbType: 'postgres',
    });

    const overallRow = (over: Record<string, unknown> = {}) => ({
      isOverall: true,
      connectionId: null,
      completed: '0',
      failed: '0',
      p50: null,
      p95: null,
      ...over,
    });

    const connectionRow = (connectionId: string, over: Record<string, unknown> = {}) => ({
      isOverall: false,
      connectionId,
      completed: '0',
      failed: '0',
      p50: null,
      p95: null,
      ...over,
    });

    const schedule = (connectionId: string, cronExpression: string, over: Record<string, unknown> = {}) => ({
      cronjobId: `cron-${connectionId}-${cronExpression}`,
      connectionId,
      cronExpression,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      ...over,
    });

    const failedOnlyBackup = () => ({
      connectionId: 'a',
      status: 'failed',
      createdAt: new Date('2026-03-15T11:00:00.000Z'),
      completedAt: null,
      durationSeconds: null,
      fileSizeMb: null,
      lastSuccessAt: null,
    });

    /** One connection `a` whose only success happened `ageMs` before NOW. */
    function givenSuccessAge(ageMs: number | null, cronExpressions: string[]) {
      repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
      repository.findActiveSchedules.mockResolvedValue(cronExpressions.map((expression) => schedule('a', expression)));
      repository.getLatestBackups.mockResolvedValue(
        ageMs === null
          ? []
          : [
              {
                connectionId: 'a',
                status: 'completed',
                createdAt: new Date(NOW.getTime() - ageMs),
                completedAt: new Date(NOW.getTime() - ageMs),
                durationSeconds: 5,
                fileSizeMb: 1,
                lastSuccessAt: new Date(NOW.getTime() - ageMs),
              },
            ],
      );
    }

    const freshnessOf = async () => (await service.getConnectionsHealth(7, NOW)).connections[0].freshness;

    it('scopes the window statistics to the UTC days of the window, today included', async () => {
      await service.getConnectionsHealth(7, NOW);

      expect(repository.getWindowStatsRows).toHaveBeenCalledWith({ from: '2026-03-09', toExclusive: '2026-03-16' });
    });

    it('defaults to a 30-day window and to the current time', async () => {
      jest.useFakeTimers().setSystemTime(NOW);

      const result = await service.getConnectionsHealth();

      expect(result.window).toBe(30);
      expect(result).toMatchObject({ from: '2026-02-14', to: '2026-03-15', timezone: 'UTC' });
      expect(repository.getWindowStatsRows).toHaveBeenCalledWith({ from: '2026-02-14', toExclusive: '2026-03-16' });
    });

    it('returns the envelope with zero counts and null statistics when nothing ran and nothing is configured', async () => {
      const result = await service.getConnectionsHealth(7, NOW);

      expect(result).toEqual({
        window: 7,
        from: '2026-03-09',
        to: '2026-03-15',
        timezone: 'UTC',
        overall: { completed: 0, failed: 0, successRate: null, p50DurationSeconds: null, p95DurationSeconds: null },
        connections: [],
      });
    });

    it('does not query backups or schedules when there is no active production connection', async () => {
      await service.getConnectionsHealth(7, NOW);

      expect(repository.getLatestBackups).not.toHaveBeenCalled();
      expect(repository.findActiveSchedules).not.toHaveBeenCalled();
    });

    it('asks for the last backups and schedules of exactly the listed connections', async () => {
      repository.findActiveProdConnections.mockResolvedValue([connection('b', 'Beta'), connection('a', 'Alpha')]);

      await service.getConnectionsHealth(7, NOW);

      expect(repository.getLatestBackups).toHaveBeenCalledWith(['a', 'b']);
      expect(repository.findActiveSchedules).toHaveBeenCalledWith(['a', 'b']);
    });

    describe('overall and per-connection window statistics', () => {
      it('rounds durations to one decimal and the success rate to four, and reports counts as numbers', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
        repository.getWindowStatsRows.mockResolvedValue([
          overallRow({ completed: '2', failed: '1', p50: 12.34, p95: 99.96 }),
          connectionRow('a', { completed: '2', failed: '1', p50: 12.34, p95: 99.96 }),
        ]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.overall).toEqual({
          completed: 2,
          failed: 1,
          successRate: 0.6667,
          p50DurationSeconds: 12.3,
          p95DurationSeconds: 100,
        });
        expect(result.connections[0]).toMatchObject({
          completed: 2,
          failed: 1,
          successRate: 0.6667,
          p50DurationSeconds: 12.3,
          p95DurationSeconds: 100,
        });
      });

      it('has a null success rate when nothing completed or failed, and a rate of 0 when everything failed', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha'), connection('b', 'Beta')]);
        repository.getWindowStatsRows.mockResolvedValue([
          overallRow({ completed: '0', failed: '3' }),
          connectionRow('b', { completed: '0', failed: '3' }),
        ]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.overall.successRate).toBe(0);
        expect(result.connections.map((c) => [c.connectionId, c.successRate])).toEqual([
          ['a', null],
          ['b', 0],
        ]);
      });

      it('has a success rate of 1 when nothing failed', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
        repository.getWindowStatsRows.mockResolvedValue([
          overallRow({ completed: '4', failed: '0' }),
          connectionRow('a', { completed: '4', failed: '0' }),
        ]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.overall.successRate).toBe(1);
        expect(result.connections[0].successRate).toBe(1);
      });

      it('falls back to zeros and nulls when the repository returns no overall row', async () => {
        repository.getWindowStatsRows.mockResolvedValue([]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.overall).toEqual({
          completed: 0,
          failed: 0,
          successRate: null,
          p50DurationSeconds: null,
          p95DurationSeconds: null,
        });
      });

      it('lists a connection without any job in the window with zeros and nulls', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
        repository.getWindowStatsRows.mockResolvedValue([overallRow({ completed: '9', failed: '1' })]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.connections).toEqual([
          {
            connectionId: 'a',
            connectionName: 'Alpha',
            environment: 'prod',
            dbType: 'postgres',
            completed: 0,
            failed: 0,
            successRate: null,
            p50DurationSeconds: null,
            p95DurationSeconds: null,
            lastBackup: null,
            lastSuccessAt: null,
            schedules: [],
            freshness: 'unknown',
          },
        ]);
      });

      it('ignores the statistics of connections that are not listed (inactive, not production, deleted)', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
        repository.getWindowStatsRows.mockResolvedValue([
          overallRow({ completed: '5', failed: '5' }),
          connectionRow('a', { completed: '1', failed: '0' }),
          connectionRow('inactive', { completed: '4', failed: '5' }),
        ]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.connections).toHaveLength(1);
        expect(result.connections[0]).toMatchObject({ connectionId: 'a', completed: 1, failed: 0 });
        expect(result.overall).toMatchObject({ completed: 5, failed: 5 });
      });
    });

    describe('ordering', () => {
      it('sorts the connections by name, ignoring case, and breaks ties by id', async () => {
        repository.findActiveProdConnections.mockResolvedValue([
          connection('6', 'Zulu'),
          connection('3', 'zeta'),
          connection('2', 'beta'),
          connection('5', 'Alpha'),
          connection('1', 'beta'),
          connection('4', 'alpha-two'),
        ]);

        const result = await service.getConnectionsHealth(7, NOW);

        // "zeta" before "Zulu" is what tells a case-insensitive order from a code-unit one.
        expect(result.connections.map((c) => c.connectionId)).toEqual(['5', '4', '1', '2', '3', '6']);
      });
    });

    describe('lastBackup and lastSuccessAt', () => {
      it('maps the latest completed or failed backup, with ISO timestamps and rounded duration and size', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
        repository.getLatestBackups.mockResolvedValue([
          {
            connectionId: 'a',
            status: 'failed',
            createdAt: new Date('2026-03-15T11:00:00.000Z'),
            completedAt: new Date('2026-03-15T11:00:30.000Z'),
            durationSeconds: 30.04,
            fileSizeMb: 12.3456,
            lastSuccessAt: new Date('2026-03-14T10:00:00.000Z'),
          },
        ]);

        const [row] = (await service.getConnectionsHealth(7, NOW)).connections;

        expect(row.lastBackup).toEqual({
          status: 'failed',
          createdAt: '2026-03-15T11:00:00.000Z',
          completedAt: '2026-03-15T11:00:30.000Z',
          durationSeconds: 30,
          fileSizeMb: 12.35,
        });
        expect(row.lastSuccessAt).toBe('2026-03-14T10:00:00.000Z');
      });

      it('keeps null completion, duration and size, and a null lastSuccessAt when the connection never succeeded', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha')]);
        repository.getLatestBackups.mockResolvedValue([failedOnlyBackup()]);

        const [row] = (await service.getConnectionsHealth(7, NOW)).connections;

        expect(row.lastBackup).toEqual({
          status: 'failed',
          createdAt: '2026-03-15T11:00:00.000Z',
          completedAt: null,
          durationSeconds: null,
          fileSizeMb: null,
        });
        expect(row.lastSuccessAt).toBeNull();
      });
    });

    describe('schedules', () => {
      it('returns the active schedules of each connection with ISO dates and the interval of the cron expression', async () => {
        repository.findActiveProdConnections.mockResolvedValue([connection('a', 'Alpha'), connection('b', 'Beta')]);
        repository.findActiveSchedules.mockResolvedValue([
          schedule('a', HOURLY, {
            cronjobId: 'job-1',
            nextRunAt: new Date('2026-03-15T13:00:00.000Z'),
            lastRunAt: new Date('2026-03-15T12:00:00.000Z'),
            lastStatus: 'completed',
          }),
          schedule('b', DAILY, { cronjobId: 'job-2' }),
        ]);

        const result = await service.getConnectionsHealth(7, NOW);

        expect(result.connections[0].schedules).toEqual([
          {
            cronjobId: 'job-1',
            nextRunAt: '2026-03-15T13:00:00.000Z',
            lastRunAt: '2026-03-15T12:00:00.000Z',
            lastStatus: 'completed',
            intervalSeconds: 3_600,
          },
        ]);
        expect(result.connections[1].schedules).toEqual([
          { cronjobId: 'job-2', nextRunAt: null, lastRunAt: null, lastStatus: null, intervalSeconds: 86_400 },
        ]);
      });

      it('reports the largest gap of an irregular schedule whatever the time of day it is asked', async () => {
        givenSuccessAge(1_000, ['0 9,17 * * *']);

        for (const hour of ['08', '12', '20']) {
          const now = new Date(`2026-03-15T${hour}:00:00.000Z`);
          const [row] = (await service.getConnectionsHealth(7, now)).connections;

          expect(row.schedules[0].intervalSeconds).toBe(16 * 3_600);
        }
      });

      it('has a null interval for an invalid cron expression instead of failing the request', async () => {
        givenSuccessAge(1_000, ['definitely not cron']);

        const [row] = (await service.getConnectionsHealth(7, NOW)).connections;

        expect(row.schedules).toHaveLength(1);
        expect(row.schedules[0].intervalSeconds).toBeNull();
      });
    });

    describe('freshness', () => {
      const HOUR_MS = 3_600_000;

      it('is ok while the last success is not older than 1.5 intervals, boundary included', async () => {
        givenSuccessAge(0, [HOURLY]);
        expect(await freshnessOf()).toBe('ok');

        givenSuccessAge(1.5 * HOUR_MS, [HOURLY]);
        expect(await freshnessOf()).toBe('ok');
      });

      it('is late just past 1.5 intervals and up to 3 intervals, boundary included', async () => {
        givenSuccessAge(1.5 * HOUR_MS + 1, [HOURLY]);
        expect(await freshnessOf()).toBe('late');

        givenSuccessAge(3 * HOUR_MS, [HOURLY]);
        expect(await freshnessOf()).toBe('late');
      });

      it('is stale just past 3 intervals', async () => {
        givenSuccessAge(3 * HOUR_MS + 1, [HOURLY]);

        expect(await freshnessOf()).toBe('stale');
      });

      it('treats a success dated in the future (clock skew) as ok', async () => {
        givenSuccessAge(-5_000, [HOURLY]);

        expect(await freshnessOf()).toBe('ok');
      });

      it('uses the smallest interval among several active schedules', async () => {
        // Two hours old: ok for the daily schedule alone, late against the hourly one.
        givenSuccessAge(2 * HOUR_MS, [DAILY, HOURLY]);

        expect(await freshnessOf()).toBe('late');
      });

      it('ignores schedules with an invalid expression when others give an interval', async () => {
        givenSuccessAge(2 * HOUR_MS, ['broken', HOURLY]);

        expect(await freshnessOf()).toBe('late');
      });

      it('is stale when a schedule exists but the connection never had a success', async () => {
        givenSuccessAge(null, [HOURLY]);

        expect(await freshnessOf()).toBe('stale');
      });

      it('is stale when the only backups ever made failed', async () => {
        givenSuccessAge(null, [HOURLY]);
        repository.getLatestBackups.mockResolvedValue([failedOnlyBackup()]);

        expect(await freshnessOf()).toBe('stale');
      });

      it('is unknown when there is no active schedule, even with a recent success', async () => {
        givenSuccessAge(1_000, []);

        expect(await freshnessOf()).toBe('unknown');
      });

      it('is unknown when no schedule yields an interval', async () => {
        givenSuccessAge(1_000, ['broken']);

        expect(await freshnessOf()).toBe('unknown');
      });

      it('uses the injected clock: the same success is ok now and stale a day later', async () => {
        givenSuccessAge(HOUR_MS, [HOURLY]);
        const later = new Date(NOW.getTime() + 24 * HOUR_MS);

        const [now, afterADay] = await Promise.all([
          service.getConnectionsHealth(7, NOW),
          service.getConnectionsHealth(7, later),
        ]);

        expect(now.connections[0].freshness).toBe('ok');
        expect(afterADay.connections[0].freshness).toBe('stale');
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
