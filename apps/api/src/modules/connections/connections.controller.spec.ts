/// <reference types="jest" />
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AddressInfo } from 'net';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { Environment } from '../../database/enums/environment.enum';
import { RolesGuard } from '../../auth/roles.guard';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { validationPipeOptions } from '../../common/pipes/validation-pipe.options';
import { ConnectionsController } from './connections.controller';
import { ConnectionsRepository } from './connections.repository';
import { ConnectionsService } from './connections.service';
import { BetterAuthGuard } from '../../auth/auth.guard';

jest.mock('../../auth/auth.guard', () => ({
  BetterAuthGuard: class {},
}));

// The probes below never reach a database server.
const mockPgClient = {
  connect: jest.fn(),
  end: jest.fn(),
};
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => mockPgClient),
}));
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));

// Responses of every connections endpoint must never carry the database
// password. The app below wires the same global pipe, serializer, envelope and
// filter as AppModule, and the real controller, service and repository run on
// top of a faked TypeORM, so the whole serialization path is exercised.
describe('ConnectionsController responses', () => {
  const CONNECTION_ID = '5f0f9f0e-9a7e-4f1d-8f43-3b0a3d8b6a11';
  const STORED_PASSWORD = 'stored-secret-password';
  const NEW_PASSWORD = 'new-secret-password';

  const newPayload = {
    name: 'Billing',
    environment: Environment.PROD,
    dbType: DbTypeEnum.POSTGRES,
    host: 'db.internal',
    port: 5432,
    database: 'billing',
    username: 'billing_user',
    password: NEW_PASSWORD,
  };

  // What TypeORM hands back after loading a row: an entity instance whose
  // transformer has already decrypted the password.
  const loadedEntity = (overrides: Partial<ConnectionEntity> = {}): ConnectionEntity =>
    Object.assign(new ConnectionEntity(), {
      id: CONNECTION_ID,
      name: 'Billing',
      slug: 'billing',
      environment: Environment.PROD,
      dbType: DbTypeEnum.POSTGRES,
      host: 'db.internal',
      port: 5432,
      database: 'billing',
      username: 'billing_user',
      password: STORED_PASSWORD,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    });

  let app: INestApplication;
  let manager: { findOne: jest.Mock; query: jest.Mock; save: jest.Mock };
  let baseUrl: string;

  beforeAll(async () => {
    // TypeORM's save() resolves the object it was given, completed with the
    // generated columns; the fakes below do the same.
    const connectionRepo = {
      find: jest.fn(async () => [loadedEntity()]),
      findOne: jest.fn(async () => loadedEntity()),
      create: jest.fn((data: Partial<ConnectionEntity>) =>
        Object.assign(new ConnectionEntity(), data),
      ),
      save: jest.fn(async (entity: ConnectionEntity) =>
        Object.assign(entity, { id: CONNECTION_ID, isActive: true }),
      ),
    };
    manager = {
      findOne: jest.fn(async () => loadedEntity()),
      query: jest.fn(async () => []),
      save: jest.fn(async (...args: unknown[]) => args[args.length - 1]),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) => work(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectionsController],
      providers: [
        ConnectionsService,
        ConnectionsRepository,
        { provide: getRepositoryToken(ConnectionEntity), useValue: connectionRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: APP_PIPE, useValue: new ValidationPipe(validationPipeOptions) },
        { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    })
      .overrideGuard(BetterAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.end.mockResolvedValue(undefined);
  });

  async function call(method: string, path: string, body?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, json: text ? JSON.parse(text) : undefined };
  }

  function keysOf(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
      value.forEach((item) => keysOf(item, found));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        found.add(key);
        keysOf(nested, found);
      }
    }
    return found;
  }

  function expectNoSecret(text: string, json: unknown): void {
    expect(text).not.toContain(STORED_PASSWORD);
    expect(text).not.toContain(NEW_PASSWORD);
    expect([...keysOf(json)].filter((key) => /pass(word)?|secret/i.test(key))).toEqual([]);
  }

  // test-raw has its own DTO, which has neither a name nor an environment.
  const rawPayload = {
    dbType: newPayload.dbType,
    host: newPayload.host,
    port: newPayload.port,
    database: newPayload.database,
    username: newPayload.username,
    password: NEW_PASSWORD,
  };
  const connectionPath = `/connections/${CONNECTION_ID}`;

  const endpoints: Array<{ name: string; method: string; path: string; status: number; body?: object }> = [
    { name: 'list', method: 'GET', path: '/connections', status: 200 },
    { name: 'list by environment', method: 'GET', path: '/connections?environment=prod', status: 200 },
    { name: 'read', method: 'GET', path: connectionPath, status: 200 },
    { name: 'create', method: 'POST', path: '/connections', status: 201, body: newPayload },
    { name: 'update (rename)', method: 'PATCH', path: connectionPath, status: 200, body: { name: 'Renamed' } },
    {
      name: 'update (new password)',
      method: 'PATCH',
      path: connectionPath,
      status: 200,
      body: { password: NEW_PASSWORD },
    },
    {
      name: 'update (every field)',
      method: 'PATCH',
      path: connectionPath,
      status: 200,
      body: { ...newPayload, name: 'Renamed' },
    },
    { name: 'delete', method: 'DELETE', path: connectionPath, status: 200 },
    { name: 'test by path id', method: 'POST', path: `${connectionPath}/test`, status: 201 },
    {
      name: 'test by body id',
      method: 'POST',
      path: '/connections/test',
      status: 201,
      body: { connectionId: CONNECTION_ID },
    },
    { name: 'test-raw', method: 'POST', path: '/connections/test-raw', status: 201, body: rawPayload },
  ];

  it.each(endpoints)('$name never returns the password', async ({ method, path, status, body }) => {
    const response = await call(method, path, body);

    expect(response.status).toBe(status);
    expectNoSecret(response.text, response.json);
  });

  it('test-raw never returns the password when the connection fails', async () => {
    mockPgClient.connect.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:5432'));

    const response = await call('POST', '/connections/test-raw', rawPayload);

    expect(response.status).toBe(201);
    expect(response.json.data).toMatchObject({ success: false });
    expectNoSecret(response.text, response.json);
  });

  it('update returns the saved fields without the password', async () => {
    const response = await call('PATCH', `/connections/${CONNECTION_ID}`, { name: 'Renamed' });

    expect(response.json.data).toMatchObject({
      id: CONNECTION_ID,
      name: 'Renamed',
      host: 'db.internal',
      username: 'billing_user',
    });
    expect(response.json.data).not.toHaveProperty('password');
  });

  // PATCH is a partial update: whatever the request does not name must stay as
  // stored. Every update used to reset the engine to PostgreSQL because the
  // update DTO inherited the create DTO's default.
  describe('update keeps the stored engine unless the request names one', () => {
    const lastSaved = (): ConnectionEntity => manager.save.mock.calls.at(-1)?.at(-1);

    it('a rename leaves a MySQL connection as MySQL', async () => {
      manager.findOne.mockResolvedValueOnce(loadedEntity({ dbType: DbTypeEnum.MYSQL }));

      const response = await call('PATCH', connectionPath, { name: 'Renamed' });

      expect(response.status).toBe(200);
      expect(response.json.data).toMatchObject({ name: 'Renamed', dbType: DbTypeEnum.MYSQL });
      expect(lastSaved()).toMatchObject({ name: 'Renamed', dbType: DbTypeEnum.MYSQL });
    });

    it('naming the engine changes it', async () => {
      manager.findOne.mockResolvedValueOnce(loadedEntity({ dbType: DbTypeEnum.MYSQL }));

      const response = await call('PATCH', connectionPath, { dbType: DbTypeEnum.POSTGRES });

      expect(response.status).toBe(200);
      expect(response.json.data).toMatchObject({ dbType: DbTypeEnum.POSTGRES });
      expect(lastSaved()).toMatchObject({ dbType: DbTypeEnum.POSTGRES });
    });
  });
});
