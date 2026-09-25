import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { ConnectionsRepository } from './connections.repository';

describe('ConnectionsRepository', () => {
  let repository: ConnectionsRepository;
  let dataSource: DataSource;
  let connectionRepo: Repository<ConnectionEntity>;
  let manager: jest.Mocked<EntityManager>;

  beforeEach(async () => {
    manager = {
      findOne: jest.fn(),
      query: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (em: EntityManager) => Promise<unknown>) => cb(manager)),
    } as unknown as DataSource;

    connectionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as Repository<ConnectionEntity>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionsRepository,
        { provide: getRepositoryToken(ConnectionEntity), useValue: connectionRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    repository = module.get<ConnectionsRepository>(ConnectionsRepository);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('lockAndCheckLease', () => {
    it('casts targetConnectionId to uuid when checking active leases on update', async () => {
      const mockConn = { id: 'conn-1', name: 'Test', isActive: true } as ConnectionEntity;
      (manager.findOne as jest.Mock).mockResolvedValue(mockConn);
      (manager.query as jest.Mock).mockResolvedValue([]);
      (manager.save as jest.Mock).mockResolvedValue({ ...mockConn, name: 'Updated' });

      const result = await repository.update('conn-1', { name: 'Updated' });

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('"targetConnectionId" = $1::uuid'),
        ['conn-1'],
      );
      expect(result).toEqual({ ...mockConn, name: 'Updated' });
    });

    it('returns leased when an active lease exists', async () => {
      const mockConn = { id: 'conn-1', name: 'Test', isActive: true } as ConnectionEntity;
      (manager.findOne as jest.Mock).mockResolvedValue(mockConn);
      (manager.query as jest.Mock).mockResolvedValue([{ targetConnectionId: 'conn-1' }]);

      const result = await repository.update('conn-1', { name: 'Updated' });

      expect(result).toBe('leased');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns missing when connection does not exist', async () => {
      (manager.findOne as jest.Mock).mockResolvedValue(null);

      const result = await repository.update('conn-nonexistent', { name: 'Updated' });

      expect(result).toBe('missing');
      expect(manager.query).not.toHaveBeenCalled();
    });
  });
});
