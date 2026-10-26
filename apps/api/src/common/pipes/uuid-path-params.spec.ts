/// <reference types="jest" />
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { EMPTY } from 'rxjs';
import { SseService } from '../../shared/sse/sse.service';
import { AuditController } from '../../modules/audit/audit.controller';
import { AuditService } from '../../modules/audit/audit.service';
import { BackupController } from '../../modules/backup/backup.controller';
import { BackupService } from '../../modules/backup/backup.service';
import { ConnectionDeletionService } from '../../modules/connections/connection-deletion.service';
import { ConnectionsController } from '../../modules/connections/connections.controller';
import { ConnectionsService } from '../../modules/connections/connections.service';
import { BackupSettingsController } from '../../modules/cronjobs/backup-settings.controller';
import { CronjobsController } from '../../modules/cronjobs/cronjobs.controller';
import { CronjobsService } from '../../modules/cronjobs/cronjobs.service';
import { JobsController } from '../../modules/jobs/jobs.controller';
import { JobsService } from '../../modules/jobs/jobs.service';
import { RestoreSseController } from '../../modules/restore/restore-sse.controller';
import { RestoreController } from '../../modules/restore/restore.controller';
import { RestoreService } from '../../modules/restore/restore.service';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { TransformInterceptor } from '../interceptors/transform.interceptor';
import { validationPipeOptions } from './validation-pipe.options';

// Every id in a path (a UUID column) is validated before it reaches a service,
// and so before it reaches the database, which rejects a malformed uuid with an
// error that used to surface as a 500. The app below runs the real controllers
// with the same global pipe, envelope and exception filter as AppModule and
// mocked services. When a controller gains a route with a UUID path parameter,
// add it to `idRoutes`. Slug parameters (maintenance/retention/:connectionSlug)
// are not UUIDs and are deliberately not listed.
describe('UUID path parameters', () => {
  const VALID_ID = '6c1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const MALFORMED_IDS = ['not-a-uuid', '123', 'g1f2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b', '6c1f2b3a4d5e4f608a7b9c0d1e2f3a4b'];

  // Every service method the controllers above call. Each one resolves a value
  // with the few fields the controllers read from it.
  const found = {
    id: VALID_ID,
    environment: 'dev',
    connectionId: VALID_ID,
    fileKey: 'billing/manual/dump.dump',
    jobId: VALID_ID,
  };
  const serviceMethods = {
    connections: ['findAll', 'findById', 'findByIdSafe', 'update', 'testByConnectionId'],
    connectionDeletion: ['delete'],
    backup: [
      'getHistory',
      'listBackups',
      'listDumpsFromR2',
      'listEnrichedDumps',
      'triggerManual',
      'getDownloadUrl',
      'cancelBackup',
      'getBackupById',
    ],
    restore: ['listRestores', 'cancelRestore', 'getRestoreById'],
    jobs: ['getBackupJobs', 'getRestoreJobs', 'getBackupJobById', 'getRestoreJobById', 'getSummary', 'getStats', 'getDailyCounts'],
    audit: ['getLogs', 'getLogById'],
    cronjobs: ['findAll', 'findById', 'update', 'delete', 'toggle', 'upsertSchedule'],
  } as const;

  type ServiceName = keyof typeof serviceMethods;
  const services = {} as Record<ServiceName, Record<string, jest.Mock>>;
  const sse = { subscribe: jest.fn() };

  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    for (const name of Object.keys(serviceMethods) as ServiceName[]) {
      services[name] = Object.fromEntries(
        serviceMethods[name].map((method) => [method, jest.fn()]),
      );
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ConnectionsController,
        BackupController,
        RestoreController,
        RestoreSseController,
        JobsController,
        AuditController,
        CronjobsController,
        BackupSettingsController,
      ],
      providers: [
        { provide: ConnectionsService, useValue: services.connections },
        { provide: ConnectionDeletionService, useValue: services.connectionDeletion },
        { provide: BackupService, useValue: services.backup },
        { provide: RestoreService, useValue: services.restore },
        { provide: JobsService, useValue: services.jobs },
        { provide: AuditService, useValue: services.audit },
        { provide: CronjobsService, useValue: services.cronjobs },
        { provide: SseService, useValue: sse },
        { provide: APP_PIPE, useValue: new ValidationPipe(validationPipeOptions) },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
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
    jest.clearAllMocks();
    for (const group of Object.values(services)) {
      for (const method of Object.values(group)) {
        method.mockResolvedValue(found);
      }
    }
    sse.subscribe.mockReturnValue(EMPTY);
  });

  async function call(method: string, path: string, body?: object) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : undefined };
  }

  function calledMethods(): string[] {
    return (Object.entries(services) as Array<[ServiceName, Record<string, jest.Mock>]>).flatMap(
      ([name, group]) =>
        Object.entries(group)
          .filter(([, mock]) => mock.mock.calls.length > 0)
          .map(([method]) => `${name}.${method}`),
    );
  }

  interface IdRoute {
    route: string;
    method: string;
    path: (id: string) => string;
    body?: object;
    // The service method that must receive the id when it is a UUID.
    handler: [ServiceName, string];
  }

  const idRoutes: IdRoute[] = [
    { route: 'GET /connections/:id', method: 'GET', path: (id) => `/connections/${id}`, handler: ['connections', 'findById'] },
    {
      route: 'PATCH /connections/:id',
      method: 'PATCH',
      path: (id) => `/connections/${id}`,
      body: { name: 'Renamed' },
      handler: ['connections', 'update'],
    },
    {
      route: 'DELETE /connections/:id',
      method: 'DELETE',
      path: (id) => `/connections/${id}`,
      handler: ['connections', 'findByIdSafe'],
    },
    {
      route: 'POST /connections/:id/test',
      method: 'POST',
      path: (id) => `/connections/${id}/test`,
      handler: ['connections', 'findById'],
    },
    {
      route: 'POST /backups/trigger/:connectionId',
      method: 'POST',
      path: (id) => `/backups/trigger/${id}`,
      handler: ['backup', 'triggerManual'],
    },
    {
      route: 'POST /backups/:id/download-url',
      method: 'POST',
      path: (id) => `/backups/${id}/download-url`,
      handler: ['backup', 'getDownloadUrl'],
    },
    {
      route: 'POST /backups/:id/cancel',
      method: 'POST',
      path: (id) => `/backups/${id}/cancel`,
      handler: ['backup', 'cancelBackup'],
    },
    { route: 'GET /backups/:id/stream', method: 'GET', path: (id) => `/backups/${id}/stream`, handler: ['backup', 'getBackupById'] },
    { route: 'GET /backups/:id', method: 'GET', path: (id) => `/backups/${id}`, handler: ['backup', 'getBackupById'] },
    {
      route: 'POST /restores/:id/cancel',
      method: 'POST',
      path: (id) => `/restores/${id}/cancel`,
      handler: ['restore', 'cancelRestore'],
    },
    { route: 'GET /restores/:id/stream', method: 'GET', path: (id) => `/restores/${id}/stream`, handler: ['restore', 'getRestoreById'] },
    { route: 'GET /restores/:id', method: 'GET', path: (id) => `/restores/${id}`, handler: ['restore', 'getRestoreById'] },
    { route: 'GET /jobs/backups/:id', method: 'GET', path: (id) => `/jobs/backups/${id}`, handler: ['jobs', 'getBackupJobById'] },
    { route: 'GET /jobs/restores/:id', method: 'GET', path: (id) => `/jobs/restores/${id}`, handler: ['jobs', 'getRestoreJobById'] },
    { route: 'GET /audit/:id', method: 'GET', path: (id) => `/audit/${id}`, handler: ['audit', 'getLogById'] },
    { route: 'GET /cronjobs/:id', method: 'GET', path: (id) => `/cronjobs/${id}`, handler: ['cronjobs', 'findById'] },
    {
      route: 'PATCH /cronjobs/:id',
      method: 'PATCH',
      path: (id) => `/cronjobs/${id}`,
      body: { isActive: true },
      handler: ['cronjobs', 'update'],
    },
    { route: 'DELETE /cronjobs/:id', method: 'DELETE', path: (id) => `/cronjobs/${id}`, handler: ['cronjobs', 'findById'] },
    { route: 'POST /cronjobs/:id/toggle', method: 'POST', path: (id) => `/cronjobs/${id}/toggle`, handler: ['cronjobs', 'toggle'] },
    {
      route: 'PUT /backups/settings/:connectionId',
      method: 'PUT',
      path: (id) => `/backups/settings/${id}`,
      body: { cronExpression: '0 3 * * *', frequency: 'daily' },
      handler: ['cronjobs', 'upsertSchedule'],
    },
  ];

  describe.each(idRoutes)('$route', ({ method, path, body, handler: [service, handlerMethod] }) => {
    it.each(MALFORMED_IDS)('answers 400 in the error envelope for %p and calls no service', async (id) => {
      const response = await call(method, path(id), body);

      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({
        error: { code: 'BadRequestException', statusCode: 400, message: expect.stringContaining('uuid') },
        path: path(id),
      });
      expect(calledMethods()).toEqual([]);
    });

    it('passes a valid UUID on to the service', async () => {
      const response = await call(method, path(VALID_ID), body);

      expect(response.status).toBeLessThan(400);
      expect(services[service][handlerMethod]).toHaveBeenCalled();
      expect(services[service][handlerMethod].mock.calls[0]).toContain(VALID_ID);
    });
  });

  // Routes without a path id sit next to the `:id` routes and must keep winning
  // the match: the pipe changes what `:id` accepts, not which route is chosen.
  describe('static routes next to the :id routes', () => {
    const staticRoutes: Array<{ path: string; handler: [ServiceName, string] }> = [
      { path: '/backups', handler: ['backup', 'listBackups'] },
      { path: '/backups/history', handler: ['backup', 'getHistory'] },
      { path: '/backups/r2', handler: ['backup', 'listDumpsFromR2'] },
      { path: '/backups/r2/enriched?connectionSlug=billing&category=daily', handler: ['backup', 'listEnrichedDumps'] },
      { path: '/restores', handler: ['restore', 'listRestores'] },
      { path: '/jobs/backups', handler: ['jobs', 'getBackupJobs'] },
      { path: '/jobs/restores', handler: ['jobs', 'getRestoreJobs'] },
      { path: '/jobs/summary', handler: ['jobs', 'getSummary'] },
      { path: '/jobs/stats', handler: ['jobs', 'getStats'] },
      { path: '/jobs/daily-counts', handler: ['jobs', 'getDailyCounts'] },
      { path: '/audit', handler: ['audit', 'getLogs'] },
      { path: '/connections', handler: ['connections', 'findAll'] },
      { path: '/cronjobs', handler: ['cronjobs', 'findAll'] },
    ];

    it.each(staticRoutes)('GET $path still reaches its own handler', async ({ path, handler: [service, handlerMethod] }) => {
      const response = await call('GET', path);

      expect(response.status).toBe(200);
      expect(calledMethods()).toEqual([`${service}.${handlerMethod}`]);
    });

    it('answers 400, not 500, for a name that is not a route and falls into :id (GET /backups/settings)', async () => {
      const response = await call('GET', '/backups/settings');

      expect(response.status).toBe(400);
      expect(calledMethods()).toEqual([]);
    });
  });
});
