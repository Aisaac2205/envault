/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BackupRepository } from './backup.repository';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { Environment } from '../../database/enums/environment.enum';
import { JobStatus } from '../../database/enums/job-status.enum';

type MockRepo = Partial<Record<keyof Repository<BackupJobEntity>, jest.Mock>>;

describe('BackupRepository', () => {
  let backupRepo: BackupRepository;
  let mockRepo: MockRepo;
  let dataSource: DataSource;
  let querySpy: jest.SpiedFunction<DataSource['query']>;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      findAndCount: jest.fn(),
    };
    dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      database: 'test',
    });
    querySpy = jest.spyOn(dataSource, 'query');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupRepository,
        {
          provide: getRepositoryToken(BackupJobEntity),
          useValue: mockRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    backupRepo = module.get<BackupRepository>(BackupRepository);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll — paginated', () => {
    it('uses findAndCount with skip and take when pagination is provided', async () => {
      const jobs = [{ id: '1', createdAt: new Date() }] as BackupJobEntity[];
      mockRepo.findAndCount!.mockResolvedValue([jobs, 42]);

      const result = await backupRepo.findAll({ page: 2, pageSize: 10 });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        take: 10,
        skip: 10, // (page 2 - 1) * 10
      });
      expect(result).toEqual({ data: jobs, total: 42 });
    });

    it('computes skip correctly for page 1', async () => {
      mockRepo.findAndCount!.mockResolvedValue([[], 0]);

      await backupRepo.findAll({ page: 1, pageSize: 25 });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 25 }),
      );
    });

    it('returns empty data and total 0 when no records', async () => {
      mockRepo.findAndCount!.mockResolvedValue([[], 0]);

      const result = await backupRepo.findAll({ page: 1, pageSize: 25 });

      expect(result).toEqual({ data: [], total: 0 });
    });

    it('filters by connectionId, environment, and status', async () => {
      mockRepo.findAndCount!.mockResolvedValue([[], 0]);

      await backupRepo.findAll({
        page: 1,
        pageSize: 10,
        connectionId: 'conn-abc',
        environment: Environment.PROD,
        status: JobStatus.COMPLETED,
      });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            connectionId: 'conn-abc',
            environment: Environment.PROD,
            status: JobStatus.COMPLETED,
          },
        }),
      );
    });

    it('filters by date range (from and to)', async () => {
      mockRepo.findAndCount!.mockResolvedValue([[], 0]);

      const from = '2026-06-16T00:00:00Z';
      const to = '2026-06-17T00:00:00Z';
      await backupRepo.findAll({ page: 1, pageSize: 10, from, to });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: expect.anything(),
          },
        }),
      );
    });
  });

  describe('findAll — unpaginated (backward compat)', () => {
    it('uses find (not findAndCount) when no options provided', async () => {
      const jobs = [{ id: 'a' }, { id: 'b' }] as BackupJobEntity[];
      mockRepo.find!.mockResolvedValue(jobs);

      const result = await backupRepo.findAll();

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
      });
      expect(mockRepo.findAndCount).not.toHaveBeenCalled();
      expect(result).toEqual({ data: jobs, total: 2 });
    });

    it('returns all rows when no pagination given', async () => {
      const jobs = Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
      })) as BackupJobEntity[];
      mockRepo.find!.mockResolvedValue(jobs);

      const result = await backupRepo.findAll();

      expect(result.data).toHaveLength(200);
      expect(result.total).toBe(200);
    });

    it('uses find when empty object options provided (no page/pageSize)', async () => {
      const jobs = [{ id: 'x' }] as BackupJobEntity[];
      mockRepo.find!.mockResolvedValue(jobs);

      // undefined page should fall through to unpaginated path
      const result = await backupRepo.findAll({});

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(result.data).toHaveLength(1);
    });
  });

  describe('findByFileKeys and deleteByFileKeys', () => {
    it('returns empty array when fileKeys list is empty', async () => {
      const result = await backupRepo.findByFileKeys([]);
      expect(result).toEqual([]);
      expect(mockRepo.find).not.toHaveBeenCalled();
    });

    it('queries repository when fileKeys list is provided', async () => {
      const jobs = [{ id: 'job-1', fileKey: 'k1' }] as BackupJobEntity[];
      mockRepo.find!.mockResolvedValue(jobs);

      const result = await backupRepo.findByFileKeys(['k1']);
      expect(result).toEqual(jobs);
    });
  });

  describe('failPendingStale', () => {
    it('fails a PENDING row past the 60s grace period', async () => {
      querySpy.mockResolvedValue([{ id: 'job-1' }]);

      const failed = await backupRepo.failPendingStale('job-1', 'interrupted', new Date());

      expect(failed).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining(`"createdAt" < now() - interval '60 seconds'`),
        expect.arrayContaining(['job-1', JobStatus.FAILED, 'interrupted', expect.any(Date), JobStatus.PENDING]),
      );
    });

    it('leaves a PENDING row within the grace period untouched', async () => {
      querySpy.mockResolvedValue([]);

      const failed = await backupRepo.failPendingStale('job-1', 'interrupted', new Date());

      expect(failed).toBe(false);
    });
  });

  describe('failRunningWithoutLease', () => {
    it('fails a RUNNING row with no live lease', async () => {
      querySpy.mockResolvedValue([{ id: 'job-2' }]);

      const failed = await backupRepo.failRunningWithoutLease('job-2', 'interrupted', new Date());

      expect(failed).toBe(true);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        expect.arrayContaining(['job-2', JobStatus.FAILED, 'interrupted', expect.any(Date), JobStatus.RUNNING]),
      );
    });

    it('leaves a RUNNING row alone when a live lease still exists', async () => {
      querySpy.mockResolvedValue([]);

      const failed = await backupRepo.failRunningWithoutLease('job-2', 'interrupted', new Date());

      expect(failed).toBe(false);
    });
  });
});

