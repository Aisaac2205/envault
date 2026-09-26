import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MaintenanceService } from './maintenance.service';
import { BackupService } from '../backup/backup.service';
import { BackupRepository } from '../backup/backup.repository';
import { R2Service } from '../backup/r2.service';
import { RestoreRepository } from '../restore/restore.repository';
import { ConnectionsService } from '../connections/connections.service';
import { ManualRetentionSettingEntity } from '../../database/entities/manual-retention-setting.entity';
import { ConnectionRetentionPolicyEntity } from '../../database/entities/connection-retention-policy.entity';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { RETENTION_JOB_NAME, RETENTION_QUEUE_NAME } from './maintenance.constants';
import { EnrichedR2Object } from '../backup/interfaces/enriched-r2-object.interface';

describe('MaintenanceService', () => {
  let service: MaintenanceService;

  const mockBackupService = {
    listEnrichedDumps: jest.fn(),
  };

  const mockBackupRepository = {
    findByFileKeys: jest.fn(),
    deleteByFileKeys: jest.fn(),
    findById: jest.fn(),
    countFailedOlderThan: jest.fn(),
    deleteFailedOlderThan: jest.fn(),
  };

  const mockR2Service = {
    delete: jest.fn(),
    list: jest.fn(),
  };

  const mockRestoreRepository = {
    findByStatus: jest.fn(),
  };

  const mockConnectionsService = {
    findAll: jest.fn(),
    findBySlug: jest.fn(),
  };

  const mockManualRetentionRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockRetentionPolicyRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
    query: jest.fn(),
  };

  const mockRetentionQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        { provide: BackupService, useValue: mockBackupService },
        { provide: BackupRepository, useValue: mockBackupRepository },
        { provide: R2Service, useValue: mockR2Service },
        { provide: RestoreRepository, useValue: mockRestoreRepository },
        { provide: ConnectionsService, useValue: mockConnectionsService },
        {
          provide: getRepositoryToken(ManualRetentionSettingEntity),
          useValue: mockManualRetentionRepo,
        },
        {
          provide: getRepositoryToken(ConnectionRetentionPolicyEntity),
          useValue: mockRetentionPolicyRepo,
        },
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: `BullQueue_${RETENTION_QUEUE_NAME}`,
          useValue: mockRetentionQueue,
        },
      ],
    }).compile();

    service = module.get<MaintenanceService>(MaintenanceService);
  });

  describe('computeDryRun and previewCleanup', () => {
    it('computes enriched dry-run preserving protected floor and active restores', async () => {
      const now = Date.now();
      const mockDumps: EnrichedR2Object[] = [
        {
          key: 'main-db/manual/dump-1.dump',
          size: 10 * 1024 * 1024,
          lastModified: new Date(now - 1000),
          etag: 'etag-1',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.MANUAL,
          timestamp: '2026-09-25T18:00:00Z',
        },
        {
          key: 'main-db/manual/dump-2.dump',
          size: 20 * 1024 * 1024,
          lastModified: new Date(now - 5 * 24 * 60 * 60 * 1000),
          etag: 'etag-2',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.MANUAL,
          timestamp: '2026-09-20T18:00:00Z',
        },
        {
          key: 'main-db/manual/dump-3.dump',
          size: 30 * 1024 * 1024,
          lastModified: new Date(now - 40 * 24 * 60 * 60 * 1000),
          etag: 'etag-3',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.MANUAL,
          timestamp: '2026-08-15T18:00:00Z',
        },
      ];

      mockBackupService.listEnrichedDumps.mockResolvedValue(mockDumps);
      mockRestoreRepository.findByStatus.mockResolvedValue([
        { r2Key: 'main-db/manual/dump-2.dump' },
      ]);
      mockBackupRepository.findByFileKeys.mockResolvedValue([
        { fileKey: 'main-db/manual/dump-1.dump', id: 'job-1' },
        { fileKey: 'main-db/manual/dump-2.dump', id: 'job-2' },
        { fileKey: 'main-db/manual/dump-3.dump', id: 'job-3' },
      ]);

      const preview = await service.previewCleanup({
        connectionSlug: 'main-db',
        category: BackupCategory.MANUAL,
        keepLast: 1,
        maxAgeDays: 30,
      });

      expect(preview.count).toBe(1);
      expect(preview.totalBytes).toBe(30 * 1024 * 1024);
      expect(preview.totalSizeMb).toBe(30);
      expect(preview.protectedCount).toBe(2);
      expect(preview.candidates).toHaveLength(3);

      const [c1, c2, c3] = preview.candidates;
      expect(c1.reason).toBe('protected_floor');
      expect(c1.isProtected).toBe(true);
      expect(c1.jobId).toBe('job-1');

      expect(c2.reason).toBe('protected_active_restore');
      expect(c2.isProtected).toBe(true);
      expect(c2.jobId).toBe('job-2');

      expect(c3.reason).toBe('exceeds_max_age');
      expect(c3.isProtected).toBe(false);
      expect(c3.jobId).toBe('job-3');
    });

    it('returns empty preview when no dumps exist', async () => {
      mockBackupService.listEnrichedDumps.mockResolvedValue([]);

      const preview = await service.previewCleanup({
        connectionSlug: 'empty-db',
        category: BackupCategory.DAILY,
        maxAgeDays: 7,
      });

      expect(preview.count).toBe(0);
      expect(preview.totalBytes).toBe(0);
      expect(preview.totalSizeMb).toBe(0);
      expect(preview.candidates).toEqual([]);
      expect(preview.protectedCount).toBe(0);
    });
  });

  describe('previewRetentionForConnection', () => {
    it('computes preview for each configured policy on a connection', async () => {
      mockConnectionsService.findBySlug.mockResolvedValue({ id: 'conn-1', slug: 'app-db' });
      mockRetentionPolicyRepo.find.mockResolvedValue([
        { connectionId: 'conn-1', category: BackupCategory.DAILY, retentionDays: 7 },
      ]);

      const mockDumps: EnrichedR2Object[] = [
        {
          key: 'app-db/daily/dump-1.dump',
          size: 15 * 1024 * 1024,
          lastModified: new Date(),
          etag: 'etag-1',
          connectionId: 'conn-1',
          connectionSlug: 'app-db',
          connectionName: 'App DB',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-09-25T00:00:00Z',
        },
      ];
      mockBackupService.listEnrichedDumps.mockResolvedValue(mockDumps);
      mockRestoreRepository.findByStatus.mockResolvedValue([]);
      mockBackupRepository.findByFileKeys.mockResolvedValue([]);

      const results = await service.previewRetentionForConnection('app-db');

      expect(results).toHaveLength(1);
      expect(results[0].category).toBe(BackupCategory.DAILY);
      expect(results[0].count).toBe(0);
      expect(results[0].protectedCount).toBe(1);
      expect(results[0].candidates).toHaveLength(1);
    });
  });

  describe('prune: Coordinated Two-Stage Purge', () => {
    it('deletes from R2 first (dump + manifest) and then purges from control database on success', async () => {
      const now = Date.now();
      const mockDumps: EnrichedR2Object[] = [
        {
          key: 'main-db/daily/newest.dump',
          size: 5 * 1024 * 1024,
          lastModified: new Date(now),
          etag: 'etag-1',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-09-25T00:00:00Z',
        },
        {
          key: 'main-db/daily/old.dump',
          size: 50 * 1024 * 1024,
          lastModified: new Date(now - 40 * 24 * 60 * 60 * 1000),
          etag: 'etag-2',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-08-10T00:00:00Z',
        },
      ];

      mockBackupService.listEnrichedDumps.mockResolvedValue(mockDumps);
      mockRestoreRepository.findByStatus.mockResolvedValue([]);
      mockBackupRepository.findByFileKeys.mockResolvedValue([
        { fileKey: 'main-db/daily/old.dump', id: 'job-old' },
      ]);
      mockR2Service.delete.mockResolvedValue(undefined);
      mockBackupRepository.deleteByFileKeys.mockResolvedValue(1);

      const result = await service.runCleanup({
        connectionSlug: 'main-db',
        category: BackupCategory.DAILY,
        maxAgeDays: 30,
      });

      expect(result.deleted).toBe(1);
      expect(result.freedMb).toBe(50);
      expect(result.errors).toEqual([]);

      // Stage 1: R2 deletions
      expect(mockR2Service.delete).toHaveBeenCalledWith('main-db/daily/old.dump');
      expect(mockR2Service.delete).toHaveBeenCalledWith('main-db/daily/old.manifest.json');

      // Stage 2: Database purge
      expect(mockBackupRepository.deleteByFileKeys).toHaveBeenCalledWith([
        'main-db/daily/old.dump',
      ]);
    });

    it('retains database row and records error when R2 dump deletion fails (zero orphaned state)', async () => {
      const now = Date.now();
      const mockDumps: EnrichedR2Object[] = [
        {
          key: 'main-db/daily/newest.dump',
          size: 5 * 1024 * 1024,
          lastModified: new Date(now),
          etag: 'etag-1',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-09-25T00:00:00Z',
        },
        {
          key: 'main-db/daily/failed-r2.dump',
          size: 20 * 1024 * 1024,
          lastModified: new Date(now - 40 * 24 * 60 * 60 * 1000),
          etag: 'etag-2',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-08-10T00:00:00Z',
        },
      ];

      mockBackupService.listEnrichedDumps.mockResolvedValue(mockDumps);
      mockRestoreRepository.findByStatus.mockResolvedValue([]);
      mockBackupRepository.findByFileKeys.mockResolvedValue([]);
      mockR2Service.delete.mockRejectedValueOnce(new Error('R2 network timeout'));

      const result = await service.runCleanup({
        connectionSlug: 'main-db',
        category: BackupCategory.DAILY,
        maxAgeDays: 30,
      });

      expect(result.deleted).toBe(0);
      expect(result.freedMb).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        key: 'main-db/daily/failed-r2.dump',
        message: 'R2 network timeout',
      });

      // Stage 2 must NOT delete the DB record if Stage 1 failed
      expect(mockBackupRepository.deleteByFileKeys).not.toHaveBeenCalled();
    });

    it('retains database row when manifest deletion in R2 fails', async () => {
      const now = Date.now();
      const mockDumps: EnrichedR2Object[] = [
        {
          key: 'main-db/daily/newest.dump',
          size: 5 * 1024 * 1024,
          lastModified: new Date(now),
          etag: 'etag-1',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-09-25T00:00:00Z',
        },
        {
          key: 'main-db/daily/partial.dump',
          size: 10 * 1024 * 1024,
          lastModified: new Date(now - 40 * 24 * 60 * 60 * 1000),
          etag: 'etag-2',
          connectionId: 'conn-1',
          connectionSlug: 'main-db',
          connectionName: 'Main Database',
          dbType: 'postgres',
          category: BackupCategory.DAILY,
          timestamp: '2026-08-10T00:00:00Z',
        },
      ];

      mockBackupService.listEnrichedDumps.mockResolvedValue(mockDumps);
      mockRestoreRepository.findByStatus.mockResolvedValue([]);
      mockBackupRepository.findByFileKeys.mockResolvedValue([]);
      // Dump deletion succeeds, but manifest deletion fails
      mockR2Service.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Manifest deletion error'));

      const result = await service.runCleanup({
        connectionSlug: 'main-db',
        category: BackupCategory.DAILY,
        maxAgeDays: 30,
      });

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe('main-db/daily/partial.manifest.json');
      expect(mockBackupRepository.deleteByFileKeys).not.toHaveBeenCalled();
    });
  });

  describe('BullMQ Retention Queue Integration', () => {
    it('enqueues retention task in BullMQ queue when available', async () => {
      mockRetentionQueue.add.mockResolvedValue({ id: 'job-retention-123' });

      const result = await service.enqueueRetention(
        'analytics-db',
        BackupCategory.WEEKLY,
        { maxAgeDays: 90 },
      );

      expect(result.enqueued).toBe(true);
      expect(result.jobId).toBe('job-retention-123');
      expect(mockRetentionQueue.add).toHaveBeenCalledWith(
        RETENTION_JOB_NAME,
        {
          connectionSlug: 'analytics-db',
          category: BackupCategory.WEEKLY,
          policy: { maxAgeDays: 90 },
        },
        { removeOnComplete: true },
      );
    });

    it('enqueues retention tasks during sweepManualRetention when queue is present', async () => {
      const mockQueryRunner = {
        connect: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
      };
      mockDataSource.createQueryRunner.mockReturnValue(mockQueryRunner);
      mockDataSource.query
        .mockResolvedValueOnce([{ acquired: true }]) // advisory lock acquire
        .mockResolvedValueOnce([{ released: true }]); // advisory lock release

      mockConnectionsService.findAll.mockResolvedValue([
        { id: 'conn-1', slug: 'db-1', name: 'Database 1' },
      ]);
      mockRetentionPolicyRepo.find.mockResolvedValue([
        { connectionId: 'conn-1', category: BackupCategory.MANUAL, retentionDays: 14 },
      ]);
      mockRetentionQueue.add.mockResolvedValue({ id: 'sweep-job-1' });

      await service.sweepManualRetention();

      expect(mockRetentionQueue.add).toHaveBeenCalledWith(
        RETENTION_JOB_NAME,
        {
          connectionSlug: 'db-1',
          category: BackupCategory.MANUAL,
          policy: { maxAgeDays: 14 },
        },
        { removeOnComplete: true },
      );
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });
});
