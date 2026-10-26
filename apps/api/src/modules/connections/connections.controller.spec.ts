/// <reference types="jest" />
import { EventEmitter } from 'events';
import {
  CanActivate,
  ClassSerializerInterceptor,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AddressInfo } from 'net';
import { Request } from 'express';
import { PasswordConfirmation } from '../../auth/password-confirmation';
import { AuditLogEntity } from '../../database/entities/audit-log.entity';
import { ConnectionEntity } from '../../database/entities/connection.entity';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { Environment } from '../../database/enums/environment.enum';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { validationPipeOptions } from '../../common/pipes/validation-pipe.options';
import { ConnectionDeletionService } from './connection-deletion.service';
import { ConnectionsController } from './connections.controller';
import { ConnectionsRepository } from './connections.repository';
import { ConnectionsService } from './connections.service';

// The probes below never reach a database server.
// A real EventEmitter, like the pg Client: emitting 'error' with no listener throws.
const mockPgClient = Object.assign(new EventEmitter(), {
  connect: jest.fn(),
  end: jest.fn(),
});
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => mockPgClient),
}));
jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));

// Stands in for the global BetterAuthGuard: every request is signed in as the
// admin its `x-test-user` header names, so a test can give the failed
// password confirmations it makes a bucket of their own.
class SignedInAsAdmin implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: object }>();
    const id = String(request.headers['x-test-user'] ?? 'admin-1');
    request.user = { id, email: `${id}@envault.dev`, name: 'Admin', role: 'admin' };
    return true;
  }
}

// Responses of every connections endpoint must never carry the database
// password. The app below wires the same global pipe, serializer, envelope and
// filter as AppModule, and the real controller, service and repository run on
// top of a faked TypeORM, so the whole serialization path is exercised.
describe('ConnectionsController responses', () => {
  const CONNECTION_ID = '5f0f9f0e-9a7e-4f1d-8f43-3b0a3d8b6a11';
  const STORED_PASSWORD = 'stored-secret-password';
  const NEW_PASSWORD = 'new-secret-password';
  const ADMIN_PASSWORD = 'admin-account-password';

  const newPayload = {
    name: 'Billing',
    environment: Environment.QA,
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
      environment: Environment.QA,
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
  let connectionFindOne: jest.Mock;
  let auditSave: jest.Mock;
  let baseUrl: string;
  // Better Auth's check of the signed-in admin's password.
  const passwordConfirmation = {
    verify: jest.fn(async (_headers: unknown, password: string) => password === ADMIN_PASSWORD),
  };

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
    connectionFindOne = connectionRepo.findOne;
    manager = {
      findOne: jest.fn(async () => loadedEntity()),
      query: jest.fn(async () => []),
      save: jest.fn(async (...args: unknown[]) => args[args.length - 1]),
    };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => Promise<unknown>) => work(manager)),
    };
    auditSave = jest.fn(async (entry: object) => entry);

    const moduleRef = await Test.createTestingModule({
      controllers: [ConnectionsController],
      providers: [
        ConnectionsService,
        ConnectionDeletionService,
        ConnectionsRepository,
        { provide: getRepositoryToken(ConnectionEntity), useValue: connectionRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(AuditLogEntity), useValue: { save: auditSave } },
        { provide: PasswordConfirmation, useValue: passwordConfirmation },
        { provide: APP_GUARD, useClass: SignedInAsAdmin },
        { provide: APP_PIPE, useValue: new ValidationPipe(validationPipeOptions) },
        { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
    })
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockPgClient.removeAllListeners();
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.end.mockResolvedValue(undefined);
  });

  async function call(
    method: string,
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      text,
      json: text ? JSON.parse(text) : undefined,
    };
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

  it('test-raw survives a socket error emitted by a PostgreSQL connection that is already up', async () => {
    mockPgClient.end.mockImplementation(async () => {
      // The server drops the idle socket right after the handshake.
      expect(() => mockPgClient.emit('error', new Error('read ECONNRESET'))).not.toThrow();
    });

    const response = await call('POST', '/connections/test-raw', rawPayload);

    expect(response.status).toBe(201);
    expect(response.json.data).toMatchObject({ success: true });
    expect(mockPgClient.listenerCount('error')).toBeGreaterThan(0);
  });

  it('test-raw survives a socket error emitted by a MySQL connection that is already up', async () => {
    const mysqlConnection = Object.assign(new EventEmitter(), {
      end: jest.fn().mockImplementation(async () => {
        expect(() => mysqlConnection.emit('error', new Error('read ECONNRESET'))).not.toThrow();
      }),
    });
    jest.requireMock('mysql2/promise').createConnection.mockResolvedValueOnce(mysqlConnection);

    const response = await call('POST', '/connections/test-raw', {
      ...rawPayload,
      dbType: DbTypeEnum.MYSQL,
    });

    expect(response.status).toBe(201);
    expect(response.json.data).toMatchObject({ success: true });
    expect(mysqlConnection.listenerCount('error')).toBeGreaterThan(0);
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
  describe('PROD connections are immutable (security-model 1.1)', () => {
    const connectionPath = `/connections/${CONNECTION_ID}`;

    it.each([
      ['PATCH', { host: '10.66.66.66' }],
      ['PATCH', { environment: Environment.QA }],
      ['DELETE', undefined],
    ])('%s on a PROD connection is rejected with 403', async (method, body) => {
      // The controller may load the row for the audit context before the
      // service runs, so every lookup in this request must see PROD.
      connectionFindOne.mockResolvedValue(loadedEntity({ environment: Environment.PROD }));
      manager.save.mockClear();
      try {
        const response = await call(method as string, connectionPath, body as object | undefined);
        expect(response.status).toBe(403);
        expect(manager.save).not.toHaveBeenCalled();
      } finally {
        connectionFindOne.mockImplementation(async () => loadedEntity());
      }
    });

    it('reclassifying a QA connection as PROD is rejected with 403', async () => {
      const response = await call('PATCH', connectionPath, { environment: Environment.PROD });
      expect(response.status).toBe(403);
    });

    it('a refused PATCH on a PROD connection is audited under prod', async () => {
      connectionFindOne.mockResolvedValue(loadedEntity({ environment: Environment.PROD }));
      auditSave.mockClear();
      try {
        const response = await call('PATCH', connectionPath, { host: '10.66.66.66' });

        expect(response.status).toBe(403);
        expect(auditSave).toHaveBeenCalledWith(
          expect.objectContaining({ action: `PATCH ${connectionPath}`, environment: Environment.PROD }),
        );
      } finally {
        connectionFindOne.mockImplementation(async () => loadedEntity());
      }
    });

    // Telling PROD apart needs the environment only: the lookup must not load,
    // and so decrypt, the stored password. The locked read inside the
    // transaction is a separate query and is not covered here.
    it.each([
      ['PATCH', { host: '10.66.66.66' }],
      ['DELETE', undefined],
    ])('%s on a PROD connection reads it without the password', async (method, body) => {
      connectionFindOne.mockResolvedValue(loadedEntity({ environment: Environment.PROD }));
      connectionFindOne.mockClear();
      try {
        await call(method, connectionPath, body);

        expect(connectionFindOne).toHaveBeenCalled();
        for (const [options] of connectionFindOne.mock.calls) {
          expect(options).toHaveProperty('select');
          expect(options.select).not.toHaveProperty('password');
        }
      } finally {
        connectionFindOne.mockImplementation(async () => loadedEntity());
      }
    });
  });

  // An admin may delete a PROD connection (a soft delete: the production
  // database itself is never touched) after proving it is deliberate: the
  // exact connection name, and the admin's own password checked by Better
  // Auth against the session that sent the request.
  describe('deleting a PROD connection needs its exact name and the admin password', () => {
    const connectionPath = `/connections/${CONNECTION_ID}`;
    const confirmed = { confirmName: 'Billing', password: ADMIN_PASSWORD };
    const wrongPassword = { confirmName: 'Billing', password: 'not-the-password' };
    let admins = 0;
    // Failed confirmations are counted per admin, and this app lives for the
    // whole file: a test that fails passwords uses an admin of its own.
    const freshAdmin = (): string => `admin-${(admins += 1)}-${Date.now()}`;
    const deleteAs = (admin: string, body?: object, headers: Record<string, string> = {}) =>
      call('DELETE', connectionPath, body, { 'x-test-user': admin, ...headers });

    beforeEach(() => {
      connectionFindOne.mockResolvedValue(loadedEntity({ environment: Environment.PROD }));
      manager.findOne.mockResolvedValue(loadedEntity({ environment: Environment.PROD }));
      manager.save.mockClear();
      passwordConfirmation.verify.mockClear();
      auditSave.mockClear();
    });

    afterEach(() => {
      connectionFindOne.mockImplementation(async () => loadedEntity());
      manager.findOne.mockImplementation(async () => loadedEntity());
    });

    it.each([
      ['no body', undefined],
      ['no password', { confirmName: 'Billing' }],
      ['no name', { password: ADMIN_PASSWORD }],
      ['an empty password', { confirmName: 'Billing', password: '' }],
    ])('is refused with 403 for %s, without checking a password', async (_case, body) => {
      const response = await deleteAs(freshAdmin(), body);

      expect(response.status).toBe(403);
      expect(response.json.error).toEqual({
        code: 'ForbiddenException',
        statusCode: 403,
        message: expect.stringContaining('nombre exacto'),
      });
      expect(passwordConfirmation.verify).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it.each(['billing', 'Billing ', 'Other'])(
      'is refused with 403 when the name is %p, without checking a password',
      async (confirmName) => {
        const response = await deleteAs(freshAdmin(), { confirmName, password: ADMIN_PASSWORD });

        expect(response.status).toBe(403);
        expect(response.json.error).toMatchObject({ code: 'ForbiddenException', statusCode: 403 });
        expect(passwordConfirmation.verify).not.toHaveBeenCalled();
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it('is refused with 403 when the password is wrong', async () => {
      const response = await deleteAs(freshAdmin(), wrongPassword);

      expect(response.status).toBe(403);
      expect(response.json.error).toEqual({
        code: 'ForbiddenException',
        statusCode: 403,
        message: 'La confirmación de contraseña falló.',
      });
      expect(passwordConfirmation.verify).toHaveBeenCalledTimes(1);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('checks the password against the session that sent the request', async () => {
      const cookie = 'better-auth.session_token=session-of-admin';

      await deleteAs(freshAdmin(), confirmed, { cookie });

      expect(passwordConfirmation.verify).toHaveBeenCalledWith(
        expect.objectContaining({ cookie }),
        ADMIN_PASSWORD,
      );
    });

    it('soft deletes the connection with the exact name and the right password', async () => {
      const response = await deleteAs(freshAdmin(), confirmed);

      expect(response.status).toBe(200);
      expect(response.json).toEqual({ timestamp: expect.any(String) });
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save.mock.calls[0].at(-1)).toMatchObject({ id: CONNECTION_ID, isActive: false });
    });

    it('is audited under prod, with the password redacted', async () => {
      await deleteAs(freshAdmin(), confirmed);

      expect(auditSave).toHaveBeenCalledWith(
        expect.objectContaining({
          action: `DELETE ${connectionPath}`,
          environment: Environment.PROD,
          metadata: expect.objectContaining({
            body: { confirmName: 'Billing', password: '[REDACTED]' },
          }),
        }),
      );
    });

    it('answers 429 with Retry-After after 5 failed passwords, without checking a 6th', async () => {
      const admin = freshAdmin();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await deleteAs(admin, wrongPassword)).status).toBe(403);
      }
      passwordConfirmation.verify.mockClear();

      const response = await deleteAs(admin, confirmed);

      expect(response.status).toBe(429);
      expect(response.json.error).toMatchObject({ code: 'TooManyRequestsException', statusCode: 429 });
      const retryAfter = Number(response.headers.get('retry-after'));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
      expect(passwordConfirmation.verify).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();

      // The budget is the admin's own: another admin is not locked out.
      expect((await deleteAs(freshAdmin(), confirmed)).status).toBe(200);
    });

    it('runs no more than 5 password checks for parallel wrong passwords', async () => {
      const admin = freshAdmin();
      // Every check is still pending when the next request arrives.
      let release = (): void => undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      passwordConfirmation.verify.mockImplementation(async () => {
        await pending;
        return false;
      });
      try {
        const responses = Promise.all(
          Array.from({ length: 8 }, () => deleteAs(admin, wrongPassword)),
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        release();
        const statuses = (await responses).map(({ status }) => status).sort();

        expect(statuses).toEqual([403, 403, 403, 403, 403, 429, 429, 429]);
        expect(passwordConfirmation.verify).toHaveBeenCalledTimes(5);
      } finally {
        passwordConfirmation.verify.mockImplementation(
          async (_headers: unknown, password: string) => password === ADMIN_PASSWORD,
        );
      }
    });

    it('does not count successful deletes against the failure budget', async () => {
      const admin = freshAdmin();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect((await deleteAs(admin, wrongPassword)).status).toBe(403);
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await deleteAs(admin, confirmed)).status).toBe(200);
      }

      // The 5th failure is still checked and refused; only then is it locked.
      expect((await deleteAs(admin, wrongPassword)).status).toBe(403);
      expect((await deleteAs(admin, confirmed)).status).toBe(429);
    });

    it('a non-PROD connection is deleted with or without a body, and no password is checked', async () => {
      connectionFindOne.mockResolvedValue(loadedEntity({ environment: Environment.QA }));
      manager.findOne.mockResolvedValue(loadedEntity({ environment: Environment.QA }));
      const admin = freshAdmin();

      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect((await deleteAs(admin, attempt % 2 === 0 ? undefined : wrongPassword)).status).toBe(200);
      }

      expect(passwordConfirmation.verify).not.toHaveBeenCalled();
      expect(auditSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ environment: Environment.QA }),
      );
    });
  });

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
