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
      findOne: jest.fn(),
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

  describe('findById', () => {
    it('looks the job up by its id', async () => {
      const job = { id: 'job-1' } as BackupJobEntity;
      mockRepo.findOne!.mockResolvedValue(job);

      await expect(backupRepo.findById('job-1')).resolves.toBe(job);
      expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    // TypeORM drops a condition whose value is undefined, so findOne({ where: { id } })
    // with no id is a query without a where clause and returns an arbitrary row.
    it.each([undefined, null, ''])('never queries with the empty id %p', async (id) => {
      await expect(backupRepo.findById(id as unknown as string)).resolves.toBeNull();
      expect(mockRepo.findOne).not.toHaveBeenCalled();
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

  describe('purge with daily rollup', () => {
    const purgeSql = (): string => String(querySpy.mock.calls[0][0]);
    const purgeParams = (): unknown[] => querySpy.mock.calls[0][1] as unknown[];

    it('deleteByFileKeys deletes and rolls up in one statement, returning the deleted count', async () => {
      querySpy.mockResolvedValue([{ deleted: 2 }]);

      const deleted = await backupRepo.deleteByFileKeys(['k1', 'k2']);

      expect(deleted).toBe(2);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(purgeSql()).toContain('WITH deleted AS (');
      expect(purgeSql()).toContain('DELETE FROM backup_jobs');
      expect(purgeSql()).toContain(`"fileKey" = ANY($1::varchar[])`);
      expect(purgeSql()).toContain('INSERT INTO backup_daily_rollups');
      expect(purgeSql()).toContain('ON CONFLICT ("connectionId", "day") DO UPDATE');
      expect(purgeParams()).toEqual([['k1', 'k2'], JobStatus.COMPLETED, JobStatus.FAILED]);
    });

    it('deleteByIds deletes by id array and rolls up in one statement', async () => {
      querySpy.mockResolvedValue([{ deleted: 3 }]);

      const deleted = await backupRepo.deleteByIds(['id-1', 'id-2', 'id-3']);

      expect(deleted).toBe(3);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(purgeSql()).toContain('id = ANY($1::uuid[])');
      expect(purgeSql()).toContain('INSERT INTO backup_daily_rollups');
      expect(purgeParams()).toEqual([['id-1', 'id-2', 'id-3'], JobStatus.COMPLETED, JobStatus.FAILED]);
    });

    it('deleteFailedOlderThan deletes FAILED jobs before the cutoff and rolls them up in one statement', async () => {
      querySpy.mockResolvedValue([{ deleted: 5 }]);
      const cutoff = new Date('2026-03-11T12:00:00Z');

      const deleted = await backupRepo.deleteFailedOlderThan(cutoff);

      expect(deleted).toBe(5);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(purgeSql()).toContain('status = $1 AND "createdAt" < $2');
      expect(purgeSql()).toContain('INSERT INTO backup_daily_rollups');
      expect(purgeParams()).toEqual([JobStatus.FAILED, cutoff, JobStatus.COMPLETED, JobStatus.FAILED]);
    });

    it('aggregates only COMPLETED and FAILED rows, so PENDING and RUNNING are deleted uncounted', async () => {
      querySpy.mockResolvedValue([{ deleted: 1 }]);

      await backupRepo.deleteByIds(['id-1']);

      // Statuses are the bound parameters $2 (completed) and $3 (failed) after the id array.
      expect(purgeSql()).toContain('WHERE d.status IN ($2, $3)');
      expect(purgeSql()).toContain('FILTER (WHERE d.status = $2');
    });

    it('never interpolates input into the statement', async () => {
      querySpy.mockResolvedValue([{ deleted: 1 }]);

      await backupRepo.deleteByFileKeys(["k'; DROP TABLE backup_jobs; --"]);

      expect(purgeSql()).not.toContain('DROP TABLE');
      expect(purgeParams()[0]).toEqual(["k'; DROP TABLE backup_jobs; --"]);
    });

    it.each([
      ['deleteByFileKeys', (): Promise<number> => backupRepo.deleteByFileKeys([])],
      ['deleteByIds', (): Promise<number> => backupRepo.deleteByIds([])],
    ])('%s with an empty list returns 0 without querying', async (_name, run) => {
      await expect(run()).resolves.toBe(0);
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('returns 0 when the statement reports no rows', async () => {
      querySpy.mockResolvedValue([]);

      await expect(backupRepo.deleteByIds(['id-1'])).resolves.toBe(0);
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

