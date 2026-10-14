import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { Environment } from '../../database/enums/environment.enum';
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

  describe('partial updates', () => {
    const storedMysql = () =>
      Object.assign(new ConnectionEntity(), {
        id: 'conn-1',
        name: 'Test',
        dbType: DbTypeEnum.MYSQL,
        host: 'db.internal',
        isActive: true,
      });

    beforeEach(() => {
      (manager.findOne as jest.Mock).mockResolvedValue(storedMysql());
      (manager.query as jest.Mock).mockResolvedValue([]);
      (manager.save as jest.Mock).mockImplementation(async (...args: unknown[]) => args[args.length - 1]);
    });

    it('keeps the stored engine when the update does not name it', async () => {
      const result = await repository.update('conn-1', { name: 'Updated' });

      expect(result).toMatchObject({ name: 'Updated', dbType: DbTypeEnum.MYSQL });
    });

    it('changes the engine when the update names it', async () => {
      const result = await repository.update('conn-1', { dbType: DbTypeEnum.POSTGRES });

      expect(result).toMatchObject({ dbType: DbTypeEnum.POSTGRES });
    });

    it('does not let a field set to undefined erase the stored value', async () => {
      const result = await repository.update('conn-1', {
        name: 'Updated',
        dbType: undefined,
        host: undefined,
      });

      expect(result).toMatchObject({ name: 'Updated', dbType: DbTypeEnum.MYSQL, host: 'db.internal' });
    });
  });

  describe('secret handling', () => {
    it('saves an updated connection as a ConnectionEntity so that @Exclude() still applies to the result', async () => {
      const stored = Object.assign(new ConnectionEntity(), {
        id: 'conn-1',
        name: 'Test',
        password: 'stored-secret-password',
        isActive: true,
      });
      (manager.findOne as jest.Mock).mockResolvedValue(stored);
      (manager.query as jest.Mock).mockResolvedValue([]);
      (manager.save as jest.Mock).mockImplementation(async (...args: unknown[]) => args[args.length - 1]);

      const result = await repository.update('conn-1', { name: 'Updated' });

      expect(result).toBeInstanceOf(ConnectionEntity);
      expect(result).toMatchObject({ id: 'conn-1', name: 'Updated' });
    });

    it('never selects the password in list queries', async () => {
      (connectionRepo.find as jest.Mock).mockResolvedValue([]);

      await repository.findAll();
      await repository.findByEnvironment(Environment.DEV);
      await repository.findByIds(['conn-1']);

      const queries = (connectionRepo.find as jest.Mock).mock.calls.map(
        ([options]: [{ select: Record<string, boolean> }]) => options.select,
      );
      expect(queries).toHaveLength(3);
      for (const select of queries) {
        expect(select.password).toBeUndefined();
      }
    });
  });
});
