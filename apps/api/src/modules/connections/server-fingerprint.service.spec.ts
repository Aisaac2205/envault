import { ForbiddenException } from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { Environment } from '../../database/enums/environment.enum';
import { ConnectionsRepository } from './connections.repository';
import { ServerFingerprintService } from './server-fingerprint.service';

const pgQuery = jest.fn();
const pgConnect = jest.fn();
const pgEnd = jest.fn();
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: pgConnect,
    query: pgQuery,
    end: pgEnd,
  })),
}));

const mysqlQuery = jest.fn();
const mysqlEnd = jest.fn();
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn().mockImplementation(async () => ({
    on: jest.fn(),
    query: mysqlQuery,
    end: mysqlEnd,
  })),
}));

const endpoint = {
  host: 'db.internal',
  port: 5432,
  database: 'orders',
  username: 'user',
  password: 'secret',
};

const connection = (overrides: Partial<ConnectionEntity>): ConnectionEntity =>
  ({
    id: 'conn-1',
    name: 'Orders QA',
    environment: Environment.QA,
    dbType: DbTypeEnum.POSTGRES,
    serverFingerprint: null,
    ...endpoint,
    ...overrides,
  }) as ConnectionEntity;

describe('ConnectionEntity serialization', () => {
  it('never carries the server fingerprint or the password to a response', () => {
    const entity = Object.assign(new ConnectionEntity(), {
      name: 'Orders PROD',
      password: 'secret',
      serverFingerprint: 'postgres:111/orders',
    });

    expect(instanceToPlain(entity)).toEqual({ name: 'Orders PROD' });
  });
});

describe('ServerFingerprintService', () => {
  let service: ServerFingerprintService;
  let repository: { findActiveProd: jest.Mock; saveServerFingerprint: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    for (const mock of [pgConnect, pgQuery, pgEnd, mysqlQuery, mysqlEnd]) mock.mockReset();
    pgConnect.mockResolvedValue(undefined);
    pgEnd.mockResolvedValue(undefined);
    mysqlEnd.mockResolvedValue(undefined);
    repository = {
      findActiveProd: jest.fn().mockResolvedValue([]),
      saveServerFingerprint: jest.fn().mockResolvedValue(undefined),
    };
    service = new ServerFingerprintService(repository as unknown as ConnectionsRepository);
  });

  describe('read', () => {
    it('identifies a PostgreSQL database by the cluster and its own name', async () => {
      pgQuery.mockResolvedValue({ rows: [{ system_identifier: '7703673507083751458', db: 'orders' }] });

      await expect(service.read({ ...endpoint, dbType: DbTypeEnum.POSTGRES })).resolves.toBe(
        'postgres:7703673507083751458/orders',
      );
      expect(pgEnd).toHaveBeenCalled();
    });

    it('identifies a MySQL database by the server uuid and its own name', async () => {
      mysqlQuery.mockResolvedValue([[{ uuid: 'abc-123', db: 'orders' }]]);

      await expect(service.read({ ...endpoint, dbType: DbTypeEnum.MYSQL })).resolves.toBe(
        'mysql:abc-123/orders',
      );
      expect(mysqlEnd).toHaveBeenCalled();
    });

    it('answers null when the server cannot be asked', async () => {
      pgConnect.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.read({ ...endpoint, dbType: DbTypeEnum.POSTGRES })).resolves.toBeNull();
      expect(pgEnd).toHaveBeenCalled();
    });

    it('answers null when the identifier is not readable', async () => {
      pgConnect.mockResolvedValue(undefined);
      pgQuery.mockRejectedValue(new Error('permission denied for function pg_control_system'));

      await expect(service.read({ ...endpoint, dbType: DbTypeEnum.POSTGRES })).resolves.toBeNull();
    });
  });

  describe('assertNotProduction', () => {
    const prod = (overrides: Partial<ConnectionEntity> = {}) =>
      connection({
        id: 'prod-1',
        name: 'Orders PROD',
        environment: Environment.PROD,
        host: 'prod.internal',
        serverFingerprint: 'postgres:111/orders',
        ...overrides,
      });

    it('lets the restore go when there is no PROD connection to compare', async () => {
      await expect(service.assertNotProduction(connection({}))).resolves.toBeUndefined();
      expect(pgConnect).not.toHaveBeenCalled();
    });

    it('lets a different database through, even on the same server', async () => {
      repository.findActiveProd.mockResolvedValue([prod()]);
      pgQuery.mockResolvedValue({ rows: [{ system_identifier: '111', db: 'orders_qa' }] });

      await expect(service.assertNotProduction(connection({}))).resolves.toBeUndefined();
    });

    it('refuses a target that is the PROD database behind another address', async () => {
      repository.findActiveProd.mockResolvedValue([prod()]);
      pgQuery.mockResolvedValue({ rows: [{ system_identifier: '111', db: 'orders' }] });

      await expect(service.assertNotProduction(connection({ host: 'alias.internal' }))).rejects.toThrow(
        /Orders PROD/,
      );
      await expect(service.assertNotProduction(connection({}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses when the target cannot be identified and a PROD fingerprint exists', async () => {
      repository.findActiveProd.mockResolvedValue([prod()]);
      pgQuery.mockRejectedValue(new Error('permission denied'));

      await expect(service.assertNotProduction(connection({}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('fills in the fingerprint of a PROD connection created before it existed', async () => {
      repository.findActiveProd.mockResolvedValue([prod({ serverFingerprint: null })]);
      pgQuery
        .mockResolvedValueOnce({ rows: [{ system_identifier: '111', db: 'orders' }] })
        .mockResolvedValueOnce({ rows: [{ system_identifier: '111', db: 'orders' }] });

      await expect(service.assertNotProduction(connection({}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.saveServerFingerprint).toHaveBeenCalledWith('prod-1', 'postgres:111/orders');
    });

    it('ignores a PROD connection it cannot identify', async () => {
      repository.findActiveProd.mockResolvedValue([prod({ serverFingerprint: null })]);
      pgConnect.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.assertNotProduction(connection({}))).resolves.toBeUndefined();
      expect(repository.saveServerFingerprint).not.toHaveBeenCalled();
    });
  });
});
