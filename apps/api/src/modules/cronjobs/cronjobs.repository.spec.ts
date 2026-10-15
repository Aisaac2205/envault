/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronjobEntity } from '../../database/entities/cronjob.entity';
import { CronFrequency } from '../../database/enums/cron-frequency.enum';
import { CronjobsRepository } from './cronjobs.repository';

// The service decides from the value update() returns whether the job stays
// scheduled, so update() must answer with the whole stored row and not only
// with the fields of the request: a rename used to come back without
// `isActive`, and the service then unscheduled an active cronjob.
describe('CronjobsRepository', () => {
  let repository: CronjobsRepository;
  let typeorm: jest.Mocked<Pick<Repository<CronjobEntity>, 'findOne' | 'save' | 'merge'>>;

  const stored = (): CronjobEntity =>
    Object.assign(new CronjobEntity(), {
      id: 'cron-1',
      name: 'Nightly',
      connectionId: 'conn-1',
      cronExpression: '0 3 * * *',
      frequency: CronFrequency.DAILY,
      isActive: true,
      lastRunAt: null,
      nextRunAt: new Date('2030-01-01T03:00:00.000Z'),
      lastStatus: null,
      retentionEnabled: false,
      retentionKeepLast: null,
      retentionMaxAgeDays: null,
      retentionMaxSizeMb: null,
      createdAt: new Date('2029-12-31T00:00:00.000Z'),
      updatedAt: new Date('2029-12-31T00:00:00.000Z'),
    });

  beforeEach(async () => {
    typeorm = {
      findOne: jest.fn(),
      // TypeORM resolves save() with the object it was given.
      save: jest.fn().mockImplementation(async (entity: unknown) => entity),
      // Same semantics as Repository.merge for plain column values.
      merge: jest
        .fn()
        .mockImplementation((entity: CronjobEntity, ...sources: Partial<CronjobEntity>[]) =>
          Object.assign(entity, ...sources),
        ),
    } as unknown as typeof typeorm;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronjobsRepository,
        { provide: getRepositoryToken(CronjobEntity), useValue: typeorm },
      ],
    }).compile();

    repository = module.get(CronjobsRepository);
  });

  describe('update', () => {
    it('returns the whole stored cronjob after a rename', async () => {
      typeorm.findOne.mockResolvedValue(stored());

      const updated = await repository.update('cron-1', { name: 'Renamed' });

      expect(updated).toMatchObject({
        id: 'cron-1',
        name: 'Renamed',
        connectionId: 'conn-1',
        cronExpression: '0 3 * * *',
        frequency: CronFrequency.DAILY,
        isActive: true,
      });
    });

    it('returns the new schedule when the update names it', async () => {
      typeorm.findOne.mockResolvedValue(stored());

      const updated = await repository.update('cron-1', { cronExpression: '0 5 * * *' });

      expect(updated).toMatchObject({ cronExpression: '0 5 * * *', isActive: true, name: 'Nightly' });
    });

    it('persists the merged row, not only the fields of the request', async () => {
      typeorm.findOne.mockResolvedValue(stored());

      await repository.update('cron-1', { name: 'Renamed' });

      expect(typeorm.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cron-1', name: 'Renamed', isActive: true }),
      );
    });

    it('returns null and saves nothing when the cronjob does not exist', async () => {
      typeorm.findOne.mockResolvedValue(null);

      await expect(repository.update('missing', { name: 'Renamed' })).resolves.toBeNull();
      expect(typeorm.save).not.toHaveBeenCalled();
    });
  });
});
