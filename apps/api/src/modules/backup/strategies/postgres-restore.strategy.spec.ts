/// <reference types="jest" />
import { EventEmitter } from 'events';
import * as path from 'path';
import { PostgresRestoreStrategy } from './postgres-restore.strategy';
import { PgClientResolver } from './pg-client-resolver';
import { PgToolchain } from './pg-toolchain';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { RestoreIncompatibleError } from '../interfaces/restore-strategy.interface';

jest.mock('child_process');

const { spawn } = jest.requireMock('child_process');

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill?: jest.Mock;
};

const pgRestorePath = (major: number) =>
  path.join('/usr/lib/postgresql', String(major), 'bin', 'pg_restore');

const installed = (majors: number[]) =>
  new PgClientResolver(
    majors.map((major) => ({
      major,
      binDir: path.join('/usr/lib/postgresql', String(major), 'bin'),
    })),
  );

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The header `pg_restore -l` prints before the table of contents. */
const listing = (serverVersion: string, dumperVersion: string) =>
  [
    ';',
    '; Archive created at 2026-10-23 10:00:00 UTC',
    ';     dbname: source_db',
    ';     Dump Version: 1.16-0',
    ';     Format: CUSTOM',
    `;     Dumped from database version: ${serverVersion}`,
    `;     Dumped by pg_dump version: ${dumperVersion}`,
    ';',
    '; Selected TOC Entries:',
    '217; 1259 16390 TABLE public e2e_items test_user',
  ].join('\n');

describe('PostgresRestoreStrategy', () => {
  let strategy: PostgresRestoreStrategy;
  let readServerMajor: jest.Mock;
  let onLog: jest.Mock;

  const mockConnection = {
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    database: 'target_db',
    password: 'secret',
  } as ConnectionEntity;

  const build = (majors = [14, 15, 16, 17, 18]) => {
    const toolchain = {
      resolver: () => installed(majors),
      readServerMajor,
    } as unknown as PgToolchain;
    return new PostgresRestoreStrategy(undefined, toolchain);
  };

  const mockProcess = () => {
    const proc = new EventEmitter() as MockChildProcess;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = jest.fn();
    return proc;
  };

  /** Starts a restore whose preflight prints `output`; returns the pg_restore process it spawns. */
  async function startRestore(output: string, filePath = '/tmp/valid.dump') {
    const preflightProc = mockProcess();
    const restoreProc = mockProcess();
    spawn.mockReturnValueOnce(preflightProc).mockReturnValueOnce(restoreProc);

    const result = strategy.execute(mockConnection, filePath, onLog);
    preflightProc.stdout.emit('data', Buffer.from(output));
    preflightProc.emit('close', 0);
    await flush();
    return { result, restoreProc };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    readServerMajor = jest.fn().mockResolvedValue(17);
    onLog = jest.fn();
    strategy = build();
  });

  it('fails restore if pg_restore -l preflight exits with non-zero code', async () => {
    const preflightProc = mockProcess();
    spawn.mockReturnValueOnce(preflightProc);

    const executePromise = strategy.execute(mockConnection, '/tmp/corrupt.dump', onLog);

    preflightProc.stderr.emit(
      'data',
      Buffer.from('pg_restore: error: input file appears to be corrupted or truncated'),
    );
    preflightProc.emit('close', 1);

    await expect(executePromise).rejects.toThrow(
      'Preflight estructural falló: el dump está truncado o es inválido',
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    // The newest client lists the archive: it reads every format.
    expect(spawn).toHaveBeenCalledWith(pgRestorePath(18), ['-l', '/tmp/corrupt.dump']);
    expect(readServerMajor).not.toHaveBeenCalled();
  });

  it('runs the pg_restore of the target major when the preflight succeeds', async () => {
    const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
    restoreProc.emit('close', 0);

    await expect(result).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(1, pgRestorePath(18), ['-l', '/tmp/valid.dump']);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      pgRestorePath(17),
      [
        '-h', 'localhost',
        '-p', '5432',
        '-U', 'postgres',
        '-d', 'target_db',
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        '--single-transaction',
        '/tmp/valid.dump',
      ],
      expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: 'secret' }) }),
    );
    expect(readServerMajor).toHaveBeenCalledWith(mockConnection);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('pg_restore 17'));
  });

  it.each([
    [15, 15, 15],
    [16, 16, 16],
    [17, 17, 17],
    [15, 15, 17],
    [16, 16, 18],
  ])(
    'restores a PostgreSQL %p archive (dumped by pg_dump %p) into PostgreSQL %p with the client of the target',
    async (server, dumper, target) => {
      readServerMajor.mockResolvedValue(target);
      const { result, restoreProc } = await startRestore(listing(`${server}.4`, `${dumper}.4`));
      restoreProc.emit('close', 0);
      await result;

      expect(spawn).toHaveBeenNthCalledWith(2, pgRestorePath(target), expect.any(Array), expect.anything());
    },
  );

  describe('archives written by the old single pg_dump 18 (legacy)', () => {
    it.each([17, 18])(
      'keeps restoring a pg_dump 18 archive of the PostgreSQL 17.11 production source into PostgreSQL %p',
      async (target) => {
        readServerMajor.mockResolvedValue(target);
        const { result, restoreProc } = await startRestore(
          listing('17.11 (Debian 17.11-1.pgdg12+1)', '18.0 (Debian 18.0-1.pgdg12+3)'),
        );
        restoreProc.emit('close', 0);

        await expect(result).resolves.toBeUndefined();
        expect(spawn).toHaveBeenNthCalledWith(
          2,
          pgRestorePath(18),
          expect.arrayContaining(['--single-transaction', '-d', 'target_db']),
          expect.anything(),
        );
      },
    );

    it('blocks a pg_dump 18 archive of a PostgreSQL 16 source into PostgreSQL 16 without touching the target', async () => {
      readServerMajor.mockResolvedValue(16);
      const preflightProc = mockProcess();
      spawn.mockReturnValueOnce(preflightProc);

      const result = strategy.execute(mockConnection, '/tmp/legacy.dump', onLog);
      const failure = result.catch((error: unknown) => error);
      preflightProc.stdout.emit('data', Buffer.from(listing('16.4', '18.0')));
      preflightProc.emit('close', 0);

      const error = await failure;
      expect(error).toBeInstanceOf(RestoreIncompatibleError);
      expect((error as Error).message).toContain('pg_dump 18');
      expect((error as Error).message).toContain('PostgreSQL 17 o superior');
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  it('blocks a downgrade (PostgreSQL 17 archive into PostgreSQL 16) before running pg_restore', async () => {
    readServerMajor.mockResolvedValue(16);
    const preflightProc = mockProcess();
    spawn.mockReturnValueOnce(preflightProc);

    const result = strategy.execute(mockConnection, '/tmp/new.dump', onLog);
    const failure = result.catch((error: unknown) => error);
    preflightProc.stdout.emit('data', Buffer.from(listing('17.11', '17.11')));
    preflightProc.emit('close', 0);

    const error = await failure;
    expect(error).toBeInstanceOf(RestoreIncompatibleError);
    expect((error as Error).message).toContain('PostgreSQL 17');
    expect((error as Error).message).toContain('PostgreSQL 16');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('fails with a clear message, without running pg_restore, when the target version cannot be read', async () => {
    readServerMajor.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const preflightProc = mockProcess();
    spawn.mockReturnValueOnce(preflightProc);

    const result = strategy.execute(mockConnection, '/tmp/valid.dump', onLog);
    const failure = result.catch((error: unknown) => error);
    preflightProc.stdout.emit('data', Buffer.from(listing('17.11', '17.11')));
    preflightProc.emit('close', 0);

    expect((await failure as Error).message).toMatch(
      /No se pudo determinar la versión de PostgreSQL del servidor de destino: .*ECONNREFUSED/,
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not start pg_restore when the job was cancelled while the version was being read', async () => {
    const controller = new AbortController();
    readServerMajor.mockImplementation(async () => {
      controller.abort();
      return 17;
    });
    const preflightProc = mockProcess();
    spawn.mockReturnValueOnce(preflightProc);

    const result = strategy.execute(mockConnection, '/tmp/valid.dump', onLog, {
      abortSignal: controller.signal,
    });
    const failure = result.catch((error: unknown) => error);
    preflightProc.stdout.emit('data', Buffer.from(listing('17.11', '17.11')));
    preflightProc.emit('close', 0);

    expect((await failure as Error).message).toBe('Operación cancelada por el usuario');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('fails when no PostgreSQL client is installed', async () => {
    strategy = build([]);

    await expect(strategy.execute(mockConnection, '/tmp/valid.dump', onLog)).rejects.toThrow(
      'No hay clientes de PostgreSQL',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('lets the target client decide when the archive header has no versions', async () => {
    readServerMajor.mockResolvedValue(16);
    const { result, restoreProc } = await startRestore(';\n; Selected TOC Entries:\n');
    restoreProc.emit('close', 0);
    await result;

    expect(spawn).toHaveBeenNthCalledWith(2, pgRestorePath(16), expect.any(Array), expect.anything());
  });

  it('surfaces a pg_restore failure with its sanitized stderr', async () => {
    const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
    const failure = result.catch((error: unknown) => error);
    restoreProc.stderr.emit('data', Buffer.from('pg_restore: error: could not execute query'));
    restoreProc.emit('close', 1);

    expect((await failure as Error).message).toContain('pg_restore exited with code 1');
  });

  describe('assertCompatible (request time)', () => {
    const target = mockConnection;

    it('accepts a source older than or equal to the target', async () => {
      readServerMajor.mockResolvedValue(18);
      await expect(
        strategy.assertCompatible(target, { serverVersion: '17.11' }),
      ).resolves.toBeUndefined();
    });

    it('probes the target with a short timeout so an unreachable server cannot stall the request', async () => {
      readServerMajor.mockResolvedValue(18);

      await strategy.assertCompatible(target, { serverVersion: '17.11' });

      expect(readServerMajor).toHaveBeenCalledWith(target, { timeoutMs: 3_000 });
    });

    it('rejects a downgrade proven by the manifest server version', async () => {
      readServerMajor.mockResolvedValue(16);

      const error = await strategy
        .assertCompatible(target, { serverVersion: '17.11 (Debian 17.11-1.pgdg12+1)' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RestoreIncompatibleError);
      expect((error as Error).message).toContain('PostgreSQL 17');
      expect((error as Error).message).toContain('PostgreSQL 16');
    });

    it('rejects a target older than the oldest client even when the source is unknown', async () => {
      readServerMajor.mockResolvedValue(13);

      await expect(
        strategy.assertCompatible(target, { serverVersion: 'unknown' }),
      ).rejects.toBeInstanceOf(RestoreIncompatibleError);
    });

    it('lets the worker decide when the target cannot be reached', async () => {
      readServerMajor.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(
        strategy.assertCompatible(target, { serverVersion: '17.11' }),
      ).resolves.toBeUndefined();
    });

    it('accepts when the manifest has no server version and the target is supported', async () => {
      readServerMajor.mockResolvedValue(16);

      await expect(strategy.assertCompatible(target, {})).resolves.toBeUndefined();
    });
  });
});
