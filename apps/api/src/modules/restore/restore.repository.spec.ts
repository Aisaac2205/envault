import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RestoreJobEntity } from '../../database/entities/restore-job.entity';
import { Environment } from '../../database/enums/environment.enum';
import { RestoreRepository } from './restore.repository';

describe('RestoreRepository', () => {
  let repository: RestoreRepository;
  let dataSource: DataSource;
  let jobRepo: Repository<RestoreJobEntity>;
  let querySpy: jest.SpiedFunction<DataSource['query']>;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      database: 'test',
    });
    querySpy = jest.spyOn(dataSource, 'query');

    jobRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as Repository<RestoreJobEntity>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreRepository,
        { provide: getRepositoryToken(RestoreJobEntity), useValue: jobRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    repository = module.get<RestoreRepository>(RestoreRepository);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('startIfLeaseActive', () => {
    it('casts parameters to uuid in subquery to prevent uuid = text operator mismatch', async () => {
      querySpy.mockResolvedValue([{ id: 'job-1' }]);

      const started = await repository.startIfLeaseActive(
        'job-1',
        'target-conn-1',
        'token-1',
        new Date('2026-09-25T01:00:00.000Z'),
      );

      expect(started).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('id = $1::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"targetConnectionId" = $2::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"restoreJobId" = $1::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"leaseToken" = $6::uuid'),
        expect.any(Array),
      );
    });

    it('returns false when no rows are affected', async () => {
      querySpy.mockResolvedValue([]);

      const started = await repository.startIfLeaseActive(
        'job-1',
        'target-conn-1',
        'token-1',
        new Date('2026-09-25T01:00:00.000Z'),
      );

      expect(started).toBe(false);
    });
  });

  describe('failPendingIfLeaseInactive', () => {
    it('casts parameters to uuid to avoid type mismatch on restore_leases check', async () => {
      querySpy.mockResolvedValue([{ id: 'job-1' }]);

      const failed = await repository.failPendingIfLeaseInactive(
        'job-1',
        'target-conn-1',
        'token-1',
        'Timeout',
        new Date('2026-09-25T01:00:00.000Z'),
      );

      expect(failed).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('id = $1::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"targetConnectionId" = $2::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"restoreJobId" = $1::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"leaseToken" = $7::uuid'),
        expect.any(Array),
      );
    });
  });

  describe('recoverIfReclaimable', () => {
    it('casts targetConnectionId to uuid when querying and releasing expired leases', async () => {
      querySpy.mockResolvedValue([{ id: 'job-1' }]);

      const recovered = await repository.recoverIfReclaimable(
        'job-1',
        'target-conn-1',
        'Server restart',
        new Date('2026-09-25T01:00:00.000Z'),
      );

      expect(recovered).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('id = $1::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('"targetConnectionId" = $2::uuid'),
        expect.any(Array),
      );
    });
  });

  describe('tryCreateWithLease', () => {
    it('casts connection and lease parameters to uuid to prevent type mismatch', async () => {
      querySpy.mockResolvedValue([{ id: 'job-1' }]);

      const result = await repository.tryCreateWithLease({
        id: 'job-1',
        sourceBackupId: 'backup-1',
        r2Key: null,
        targetConnectionId: 'target-conn-1',
        targetEnvironment: Environment.DEV,
        triggeredBy: 'user-1',
        startedAt: new Date('2026-09-25T01:00:00.000Z'),
        leaseToken: 'token-1',
        expiresAt: new Date('2026-09-25T01:30:00.000Z'),
      });

      expect(result).toBe('job-1');
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $4::uuid'),
        expect.any(Array),
      );
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, $1::uuid, $8::uuid, $9'),
        expect.any(Array),
      );
    });
  });
});
