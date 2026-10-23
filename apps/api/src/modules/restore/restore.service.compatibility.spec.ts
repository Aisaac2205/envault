import { EventEmitter } from 'events';
import { UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BackupService } from '../backup/backup.service';
import { R2Service } from '../backup/r2.service';
import {
  RestoreIncompatibleError,
  RestoreStrategy,
} from '../backup/interfaces/restore-strategy.interface';
import { ConnectionsService } from '../connections/connections.service';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { JobStatus } from '../../database/enums/job-status.enum';
import { SseService } from '../../shared/sse/sse.service';
import { AuthUser } from '../../auth/decorators/current-user.decorator';
import { RestoreExecutionOwnershipService } from './restore-execution-ownership.service';
import { RestoreLeaseRepository } from './restore-lease.repository';
import { RestoreRepository } from './restore.repository';
import { RestoreService } from './restore.service';
import { RestoreStagingService } from './restore-staging.service';
import { RESTORE_QUEUE_NAME } from './restore.constants';

// The dry run reads the target through its own pg connection. A real
// EventEmitter, like the pg Client: emitting 'error' with no listener throws.
const mockPgClient = Object.assign(new EventEmitter(), {
  connect: jest.fn(),
  query: jest.fn(),
  end: jest.fn(),
});
jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => mockPgClient),
}));

// A restore that cannot work (a PostgreSQL downgrade) is refused when it is
// requested, with a 4xx and the reason, before any job, lease or queue entry
// exists.
describe('RestoreService request-time compatibility', () => {
  const targetConnectionId = '00000000-0000-0000-0000-000000000001';
  const fileKey = 'prod-db/manual/test.dump';
  const manifestKey = 'prod-db/manual/test.manifest.json';
  const testUser: AuthUser = {
    id: 'user-1',
    email: 'admin@envault.dev',
    name: 'Admin',
    role: 'admin',
  };
  const downgradeMessage =
    'No se puede restaurar un respaldo de PostgreSQL 17 en un servidor PostgreSQL 16.';

  async function build(
    strategy: RestoreStrategy,
    {
      manifest = {
        source: { serverVersion: '17.11', tableCount: 0, estimatedRows: 0, tables: [] },
      } as unknown,
    } = {},
  ) {
    const target = {
      id: targetConnectionId,
      name: 'Staging DB',
      environment: Environment.DEV,
      dbType: DbTypeEnum.POSTGRES,
    };
    const restoreRepository = {
      create: jest.fn().mockResolvedValue({ id: 'dry-job-1' }),
      tryCreateWithLease: jest.fn().mockResolvedValue('admitted-job-1'),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const r2Service = {
      downloadJson: jest.fn().mockImplementation(async (key: string) => {
        if (manifest === 'missing') throw new Error('NoSuchKey');
        if (key !== manifestKey) throw new Error(`unexpected key ${key}`);
        return manifest;
      }),
    };
    const connectionsService = {
      findById: jest.fn().mockResolvedValue(target),
      findBySlug: jest.fn().mockRejectedValue(new Error('gone')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: RestoreRepository, useValue: restoreRepository },
        { provide: RestoreLeaseRepository, useValue: { release: jest.fn() } },
        { provide: RestoreExecutionOwnershipService, useValue: {} },
        { provide: RestoreStagingService, useValue: {} },
        { provide: R2Service, useValue: r2Service },
        {
          provide: BackupService,
          useValue: {
            getBackupById: jest.fn().mockResolvedValue({
              id: 'backup-1',
              dbType: DbTypeEnum.POSTGRES,
              status: JobStatus.COMPLETED,
              fileKey,
            }),
          },
        },
        { provide: ConnectionsService, useValue: connectionsService },
        {
          provide: SseService,
          useValue: { register: jest.fn(), emit: jest.fn(), complete: jest.fn() },
        },
        { provide: getQueueToken(RESTORE_QUEUE_NAME), useValue: queue },
        {
          provide: 'RESTORE_STRATEGIES',
          useValue: new Map<DbTypeEnum, RestoreStrategy>([[DbTypeEnum.POSTGRES, strategy]]),
        },
      ],
    }).compile();

    return {
      service: module.get(RestoreService),
      restoreRepository,
      queue,
      r2Service,
      target,
    };
  }

  const request = (isDryRun: boolean) => ({
    targetConnectionId,
    sourceBackupId: 'backup-1',
    isDryRun,
  });

  it.each([false, true])(
    'refuses a downgrade with 422 and the reason before any job exists (isDryRun: %p)',
    async (isDryRun) => {
      const strategy: RestoreStrategy = {
        execute: jest.fn(),
        assertCompatible: jest.fn().mockRejectedValue(new RestoreIncompatibleError(downgradeMessage)),
      };
      const { service, restoreRepository, queue } = await build(strategy);

      const error = await service
        .createRestore(request(isDryRun), testUser)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).message).toBe(downgradeMessage);
      expect(restoreRepository.create).not.toHaveBeenCalled();
      expect(restoreRepository.tryCreateWithLease).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('a dry run survives a socket error emitted by the target connection after it is up', async () => {
    mockPgClient.removeAllListeners();
    mockPgClient.connect.mockResolvedValue(undefined);
    mockPgClient.end.mockResolvedValue(undefined);
    mockPgClient.query.mockImplementation(async () => {
      // The server drops the idle socket while the snapshot is being read.
      expect(() => mockPgClient.emit('error', new Error('read ECONNRESET'))).not.toThrow();
      return { rows: [] };
    });
    const strategy: RestoreStrategy = {
      execute: jest.fn(),
      assertCompatible: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = await build(strategy);

    const result = await service.createRestore(request(true), testUser);

    expect(result.dryRunResult?.target).toEqual({ tableCount: 0, estimatedRows: 0, tables: [] });
    expect(mockPgClient.listenerCount('error')).toBeGreaterThan(0);
  });

  it('hands the strategy the source server version recorded in the manifest', async () => {
    const strategy: RestoreStrategy = {
      execute: jest.fn(),
      assertCompatible: jest.fn().mockResolvedValue(undefined),
    };
    const { service, target } = await build(strategy);

    const result = await service.createRestore(request(false), testUser);

    expect(result.jobId).toBe('admitted-job-1');
    expect(strategy.assertCompatible).toHaveBeenCalledWith(target, { serverVersion: '17.11' });
  });

  it('still runs the check, without a source version, when the manifest cannot be read', async () => {
    const strategy: RestoreStrategy = {
      execute: jest.fn(),
      assertCompatible: jest.fn().mockResolvedValue(undefined),
    };
    const { service, target } = await build(strategy, { manifest: 'missing' });

    await expect(service.createRestore(request(false), testUser)).resolves.toMatchObject({
      jobId: 'admitted-job-1',
    });
    expect(strategy.assertCompatible).toHaveBeenCalledWith(target, { serverVersion: undefined });
  });

  it('admits the restore when the strategy has no request-time check', async () => {
    const { service, r2Service } = await build({ execute: jest.fn() });

    await expect(service.createRestore(request(false), testUser)).resolves.toMatchObject({
      jobId: 'admitted-job-1',
    });
    expect(r2Service.downloadJson).not.toHaveBeenCalled();
  });

  it('does not block on an unexpected failure of the check: the worker repeats it', async () => {
    const strategy: RestoreStrategy = {
      execute: jest.fn(),
      assertCompatible: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const { service } = await build(strategy);

    await expect(service.createRestore(request(false), testUser)).resolves.toMatchObject({
      jobId: 'admitted-job-1',
    });
  });
});
