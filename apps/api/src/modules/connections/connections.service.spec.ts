import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ConnectionsService } from './connections.service';
import { ConnectionsRepository } from './connections.repository';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { Environment } from '../../database/enums/environment.enum';

describe('ConnectionsService physical target uniqueness', () => {
  let service: ConnectionsService;
  let repository: {
    findAllSlugs: jest.Mock;
    findActiveByTarget: jest.Mock;
    findByIdSafe: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };

  const createDto = {
    name: 'Orders QA',
    environment: Environment.QA,
    dbType: DbTypeEnum.POSTGRES,
    host: ' DB.Internal ',
    port: 5432,
    database: 'orders',
    username: 'user',
    password: 'secret',
  };

  const existing = {
    id: 'conn-1',
    name: 'Orders QA',
    environment: Environment.QA,
    dbType: DbTypeEnum.POSTGRES,
    host: 'db.internal',
    port: 5432,
    database: 'orders',
  };

  const uniqueViolation = () =>
    Object.assign(new QueryFailedError('INSERT', [], new Error('duplicate key')), {
      code: '23505',
    });

  beforeEach(() => {
    repository = {
      findAllSlugs: jest.fn().mockResolvedValue([]),
      findActiveByTarget: jest.fn().mockResolvedValue(null),
      findByIdSafe: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async (data) => ({ id: 'new', ...data })),
      update: jest.fn(async (id, data) => ({ ...existing, ...data, id })),
    };
    service = new ConnectionsService(repository as unknown as ConnectionsRepository);
  });

  describe('create', () => {
    it('looks the target up with the host trimmed', async () => {
      await service.create(createDto);
      expect(repository.findActiveByTarget).toHaveBeenCalledWith({
        dbType: DbTypeEnum.POSTGRES,
        host: 'DB.Internal',
        port: 5432,
        database: 'orders',
      });
    });

    it('rejects a target that another active connection already uses', async () => {
      repository.findActiveByTarget.mockResolvedValue({ ...existing, name: 'Orders PROD' });
      await expect(service.create(createDto)).rejects.toBeInstanceOf(ConflictException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('maps a unique violation raised by a concurrent insert to 409', async () => {
      repository.create.mockRejectedValue(uniqueViolation());
      await expect(service.create(createDto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not hide other database errors', async () => {
      const boom = new Error('connection reset');
      repository.create.mockRejectedValue(boom);
      await expect(service.create(createDto)).rejects.toBe(boom);
    });
  });

  describe('update', () => {
    it('checks the merged target and excludes the connection itself', async () => {
      await service.update('conn-1', { port: 5433 });
      expect(repository.findActiveByTarget).toHaveBeenCalledWith(
        { dbType: DbTypeEnum.POSTGRES, host: 'db.internal', port: 5433, database: 'orders' },
        'conn-1',
      );
    });

    it('rejects moving onto a target that another connection uses', async () => {
      repository.findActiveByTarget.mockResolvedValue({ id: 'conn-2', name: 'Orders PROD' });
      await expect(service.update('conn-1', { database: 'billing' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('skips the lookup when no target field changes', async () => {
      await service.update('conn-1', { name: 'Renamed' });
      expect(repository.findActiveByTarget).not.toHaveBeenCalled();
    });

    it('maps a unique violation raised by a concurrent update to 409', async () => {
      repository.update.mockRejectedValue(uniqueViolation());
      await expect(service.update('conn-1', { port: 5433 })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
