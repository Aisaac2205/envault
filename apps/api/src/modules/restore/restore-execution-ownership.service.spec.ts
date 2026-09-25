import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import {
  RestoreExecutionOwnership,
  RestoreExecutionOwnershipService,
} from './restore-execution-ownership.service';

describe('RestoreExecutionOwnershipService', () => {
  let service: RestoreExecutionOwnershipService;
  let dataSource: DataSource;
  let queryRunner: jest.Mocked<QueryRunner>;

  beforeEach(async () => {
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      manager: {
        getRepository: jest.fn(),
      },
    } as unknown as jest.Mocked<QueryRunner>;

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreExecutionOwnershipService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<RestoreExecutionOwnershipService>(
      RestoreExecutionOwnershipService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('hasActiveLease', () => {
    it('casts targetConnectionId, restoreJobId, and leaseToken to uuid', async () => {
      (queryRunner.query as jest.Mock).mockResolvedValue([
        { targetConnectionId: 'target-1' },
      ]);

      const ownership: RestoreExecutionOwnership = {
        queryRunner,
        targetConnectionId: 'target-1',
      };

      const hasLease = await service.hasActiveLease(
        ownership,
        'job-1',
        'token-1',
      );

      expect(hasLease).toBe(true);
      expect(queryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('"targetConnectionId" = $1::uuid'),
        ['target-1', 'job-1', 'token-1'],
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('"restoreJobId" = $2::uuid'),
        ['target-1', 'job-1', 'token-1'],
      );
      expect(queryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('"leaseToken" = $3::uuid'),
        ['target-1', 'job-1', 'token-1'],
      );
    });

    it('returns false when no rows are found', async () => {
      (queryRunner.query as jest.Mock).mockResolvedValue([]);

      const ownership: RestoreExecutionOwnership = {
        queryRunner,
        targetConnectionId: 'target-1',
      };

      const hasLease = await service.hasActiveLease(
        ownership,
        'job-1',
        'token-1',
      );

      expect(hasLease).toBe(false);
    });
  });

  describe('tryAcquire', () => {
    it('returns ownership when advisory lock is acquired', async () => {
      (queryRunner.query as jest.Mock).mockResolvedValue([{ acquired: true }]);

      const ownership = await service.tryAcquire('target-1');

      expect(ownership).toEqual({
        queryRunner,
        targetConnectionId: 'target-1',
      });
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        ['target-1'],
      );
      expect(queryRunner.release).not.toHaveBeenCalled();
    });

    it('releases query runner and returns null when advisory lock fails', async () => {
      (queryRunner.query as jest.Mock).mockResolvedValue([{ acquired: false }]);

      const ownership = await service.tryAcquire('target-1');

      expect(ownership).toBeNull();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  describe('release', () => {
    it('unlocks advisory lock and releases query runner', async () => {
      (queryRunner.query as jest.Mock).mockResolvedValue([{ released: true }]);

      const ownership: RestoreExecutionOwnership = {
        queryRunner,
        targetConnectionId: 'target-1',
      };

      await service.release(ownership);

      expect(queryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
        ['target-1'],
      );
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });
});
