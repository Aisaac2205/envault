/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BackupRepository } from './backup.repository';
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { Environment } from '../../database/enums/environment.enum';
import { JobStatus } from '../../database/enums/job-status.enum';

type MockRepo = Partial<Record<keyof Repository<BackupJobEntity>, jest.Mock>>;

describe('BackupRepository', () => {
  let backupRepo: BackupRepository;
  let mockRepo: MockRepo;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackupRepository,
        {
          provide: getRepositoryToken(BackupJobEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    backupRepo = module.get<BackupRepository>(BackupRepository);
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
});

