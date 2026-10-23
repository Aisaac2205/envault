/// <reference types="jest" />
import { EventEmitter } from 'events';
import * as path from 'path';
import { UnrecoverableError } from 'bullmq';
import { PostgresBackupStrategy } from './postgres-backup.strategy';
import { PgClientResolver } from './pg-client-resolver';
import { PgToolchain } from './pg-toolchain';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { R2Service } from '../r2.service';
import { ConfigService } from '@nestjs/config';

jest.mock('child_process');

const { spawn } = jest.requireMock('child_process');

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter & { pipe: jest.Mock };
  stderr: EventEmitter;
  kill: jest.Mock;
};

const pgDumpPath = (major: number) =>
  path.join('/usr/lib/postgresql', String(major), 'bin', 'pg_dump');

const installed = (majors: number[]) =>
  new PgClientResolver(
    majors.map((major) => ({
      major,
      binDir: path.join('/usr/lib/postgresql', String(major), 'bin'),
    })),
  );

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('PostgresBackupStrategy', () => {
  let mockR2Service: jest.Mocked<Partial<R2Service>>;
  let readServerMajor: jest.Mock;
  let toolchain: PgToolchain;

  const mockConnection = {
    id: 'conn-1',
    name: 'Production DB',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    database: 'prod_db',
    password: 'secret',
  } as ConnectionEntity;

  const buildStrategy = (majors = [14, 15, 16, 17, 18]) => {
    toolchain = {
      resolver: () => installed(majors),
      readServerMajor,
    } as unknown as PgToolchain;
    return new PostgresBackupStrategy(mockR2Service as R2Service, undefined, toolchain);
  };

  const mockProcess = () => {
    const proc = new EventEmitter() as MockChildProcess;
    proc.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    return proc;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    readServerMajor = jest.fn().mockResolvedValue(17);
    mockR2Service = {
      upload: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('uses default timeout of 1,800,000 ms when ConfigService is not provided', () => {
    const strategy = new PostgresBackupStrategy(mockR2Service as R2Service);
    expect((strategy as unknown as { timeoutMs: number }).timeoutMs).toBe(1_800_000);
  });

  it('reads BACKUP_TIMEOUT_MS from ConfigService when provided', () => {
    const mockConfigService = {
      get: jest.fn().mockReturnValue(3_600_000),
    } as unknown as ConfigService;

    const strategy = new PostgresBackupStrategy(
      mockR2Service as R2Service,
      mockConfigService,
    );
    expect((strategy as unknown as { timeoutMs: number }).timeoutMs).toBe(3_600_000);
  });

  it('spawns the pg_dump of the source server major with custom format flags and uploads to R2', async () => {
    const strategy = buildStrategy();
    const mockProc = mockProcess();
    spawn.mockReturnValueOnce(mockProc);

    const executePromise = strategy.execute(mockConnection, 'backups/test.dump');
    await flush();

    // Simulate completion
    mockProc.emit('close', 0);

    const result = await executePromise;

    expect(readServerMajor).toHaveBeenCalledWith(mockConnection);
    expect(spawn).toHaveBeenCalledWith(
      pgDumpPath(17),
      [
        '-h', 'localhost',
        '-p', '5432',
        '-U', 'postgres',
        '-d', 'prod_db',
        '-F', 'c',
        '--no-password',
      ],
      expect.objectContaining({
        env: expect.objectContaining({ PGPASSWORD: 'secret' }),
      }),
    );
    expect(mockR2Service.upload).toHaveBeenCalledWith(
      'backups/test.dump',
      expect.anything(),
      { metadata: undefined },
    );
    expect(result).toHaveProperty('sha256');
    expect(result).toHaveProperty('fileSizeMb');
    expect(result).toHaveProperty('bytes');
  });

  it.each([14, 15, 16, 17, 18])('dumps a PostgreSQL %p source with pg_dump %p', async (major) => {
    readServerMajor.mockResolvedValue(major);
    const strategy = buildStrategy();
    const mockProc = mockProcess();
    spawn.mockReturnValueOnce(mockProc);

    const executePromise = strategy.execute(mockConnection, 'backups/test.dump');
    await flush();
    mockProc.emit('close', 0);
    await executePromise;

    expect(spawn).toHaveBeenCalledWith(pgDumpPath(major), expect.any(Array), expect.anything());
  });

  it('refuses a source older than the oldest client, before spawning anything', async () => {
    readServerMajor.mockResolvedValue(13);
    const strategy = buildStrategy();

    const failure = await strategy
      .execute(mockConnection, 'backups/test.dump')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toContain('PostgreSQL 13');
    expect(spawn).not.toHaveBeenCalled();
    expect(mockR2Service.upload).not.toHaveBeenCalled();
  });

  it('refuses a source newer than every installed client before spawning anything', async () => {
    readServerMajor.mockResolvedValue(19);
    const strategy = buildStrategy();

    const failure = await strategy
      .execute(mockConnection, 'backups/test.dump')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toContain('PostgreSQL 19');
    expect((failure as Error).message).toContain('Actualice la imagen de la API');
    expect(spawn).not.toHaveBeenCalled();
    expect(mockR2Service.upload).not.toHaveBeenCalled();
  });

  it('refuses to dump when no client is installed', async () => {
    const strategy = buildStrategy([]);

    await expect(strategy.execute(mockConnection, 'backups/test.dump')).rejects.toThrow(
      'No hay clientes de PostgreSQL',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails with a clear message, without spawning, when the source version cannot be read', async () => {
    readServerMajor.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const strategy = buildStrategy();

    await expect(strategy.execute(mockConnection, 'backups/test.dump')).rejects.toThrow(
      /No se pudo determinar la versión de PostgreSQL del servidor de origen: .*ECONNREFUSED/,
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects an already aborted signal without reading the server version', async () => {
    const strategy = buildStrategy();
    const controller = new AbortController();
    controller.abort();

    await expect(
      strategy.execute(mockConnection, 'backups/test.dump', undefined, {
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow('Operación cancelada por el usuario');
    expect(readServerMajor).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
