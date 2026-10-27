/// <reference types="jest" />
import { EventEmitter } from 'events';
import * as path from 'path';
import type { ConfigService } from '@nestjs/config';
import { PostgresRestoreStrategy } from './postgres-restore.strategy';
import { PgClientResolver } from './pg-client-resolver';
import { PgToolchain } from './pg-toolchain';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { RestoreIncompatibleError } from '../interfaces/restore-strategy.interface';

jest.mock('child_process');
jest.mock('pg', () => ({ Client: jest.fn() }));

const { spawn } = jest.requireMock('child_process');
const MockClient = jest.requireMock('pg').Client as jest.Mock;

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
  async function startRestore(
    output: string,
    filePath = '/tmp/valid.dump',
    options?: { abortSignal?: AbortSignal },
  ) {
    const preflightProc = mockProcess();
    const restoreProc = mockProcess();
    spawn.mockReturnValueOnce(preflightProc).mockReturnValueOnce(restoreProc);

    const result = strategy.execute(mockConnection, filePath, onLog, options);
    preflightProc.stdout.emit('data', Buffer.from(output));
    preflightProc.emit('close', 0);
    await flush();
    return { result, restoreProc };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // The lock watcher's connection: idle unless a test says a session waits.
    MockClient.mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ rows: [] }),
      end: jest.fn().mockResolvedValue(undefined),
    }));
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

  // A restore that is cancelled or out of time must not report back while its
  // CLI is still running: the caller releases the target's advisory lock and
  // lease as soon as it hears, and a live pg_restore would then be loading into
  // a target another restore may already own.
  describe('stopping pg_restore', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const outcome = (promise: Promise<unknown>) => {
      const state: { settled: boolean; error?: Error } = { settled: false };
      promise.then(
        () => {
          state.settled = true;
        },
        (error: Error) => {
          state.settled = true;
          state.error = error;
        },
      );
      return state;
    };
    const exit = (proc: MockChildProcess) => {
      proc.emit('exit', null, 'SIGTERM');
      proc.emit('close', null);
    };

    it('asks pg_restore to stop on cancel and rejects only after it exited', async () => {
      const controller = new AbortController();
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'), undefined, {
        abortSignal: controller.signal,
      });
      const state = outcome(result);

      controller.abort();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(restoreProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(restoreProc.kill).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      exit(restoreProc);
      await jest.advanceTimersByTimeAsync(0);

      expect(state.error?.message).toBe('Operación cancelada por el usuario');
    });

    it('kills pg_restore when it ignores the request to stop', async () => {
      const controller = new AbortController();
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'), undefined, {
        abortSignal: controller.signal,
      });
      const state = outcome(result);

      controller.abort();
      await jest.advanceTimersByTimeAsync(4_999);
      expect(restoreProc.kill).not.toHaveBeenCalledWith('SIGKILL');

      await jest.advanceTimersByTimeAsync(1);
      expect(restoreProc.kill).toHaveBeenCalledWith('SIGKILL');
      expect(state.settled).toBe(false);

      exit(restoreProc);
      await jest.advanceTimersByTimeAsync(0);
      expect(state.error?.message).toBe('Operación cancelada por el usuario');
    });

    it('stops waiting for a pg_restore that cannot be killed', async () => {
      const controller = new AbortController();
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'), undefined, {
        abortSignal: controller.signal,
      });
      const state = outcome(result);

      controller.abort();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(restoreProc.kill).toHaveBeenCalledWith('SIGKILL');
      await jest.advanceTimersByTimeAsync(5_000);

      expect(state.error?.message).toBe('Operación cancelada por el usuario');
    });

    it('keeps the abort error when the exit arrives as a failed close', async () => {
      const controller = new AbortController();
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'), undefined, {
        abortSignal: controller.signal,
      });
      const state = outcome(result);

      controller.abort();
      restoreProc.emit('close', 143);
      await jest.advanceTimersByTimeAsync(0);

      expect(state.error?.message).toBe('Operación cancelada por el usuario');
    });

    it('waits for the exit when the per-step timeout fires, too', async () => {
      strategy = new PostgresRestoreStrategy(
        { get: (key: string) => (key === 'RESTORE_TIMEOUT_MS' ? 10_000 : undefined) } as unknown as ConfigService,
        { resolver: () => installed([17, 18]), readServerMajor } as unknown as PgToolchain,
      );
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      const state = outcome(result);

      await jest.advanceTimersByTimeAsync(10_000);
      expect(restoreProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.settled).toBe(false);

      exit(restoreProc);
      await jest.advanceTimersByTimeAsync(0);
      expect(state.error?.message).toBe('pg_restore exceeded 10000ms timeout');
    });

    it('waits for the exit of the preflight listing, too', async () => {
      const controller = new AbortController();
      const preflightProc = mockProcess();
      spawn.mockReturnValueOnce(preflightProc);
      const result = strategy.execute(mockConnection, '/tmp/valid.dump', onLog, {
        abortSignal: controller.signal,
      });
      const state = outcome(result);

      controller.abort();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(preflightProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.settled).toBe(false);

      exit(preflightProc);
      await jest.advanceTimersByTimeAsync(0);
      expect(state.error?.message).toBe('Operación cancelada por el usuario');
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('does not wait for a pg_restore that already finished', async () => {
      const controller = new AbortController();
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'), undefined, {
        abortSignal: controller.signal,
      });
      restoreProc.emit('close', 0);
      await result;

      controller.abort();

      expect(restoreProc.kill).not.toHaveBeenCalled();
    });
  });

  // pg_restore opens every session with `SET lock_timeout = 0`, so a server-side
  // lock_timeout (PGOPTIONS, a role or database setting) cannot bound it. The
  // strategy watches the session from a second connection instead.
  describe('lock wait bound', () => {
    const configured = (lockWaitMs?: number) =>
      ({
        get: (key: string) => (key === 'RESTORE_LOCK_WAIT_TIMEOUT_MS' ? lockWaitMs : undefined),
      }) as unknown as ConfigService;
    const buildWith = (lockWaitMs?: number) =>
      new PostgresRestoreStrategy(configured(lockWaitMs), {
        resolver: () => installed([14, 15, 16, 17, 18]),
        readServerMajor,
      } as unknown as PgToolchain);

    /** What the watcher sees of the pg_restore session; empty rows mean "not waiting on a lock". */
    let sessions: { pid: number; statement_start: string }[];
    let cancelled: number[];
    let watcher: {
      on: jest.Mock;
      connect: jest.Mock;
      query: jest.Mock;
      end: jest.Mock;
    };

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      sessions = [];
      cancelled = [];
      watcher = {
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        end: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(async (sql: string, values: unknown[]) => {
          if (sql.includes('pg_cancel_backend')) {
            cancelled.push(values[0] as number);
            return { rows: [{ cancelled: true }] };
          }
          return { rows: sessions };
        }),
      };
      MockClient.mockImplementation(() => watcher);
    });
    /** The server answers the next cancels with these (pg_cancel_backend returns false when it did not apply). */
    const cancelAnswers = (...answers: boolean[]) => {
      watcher.query.mockImplementation(async (sql: string, values: unknown[]) => {
        if (!sql.includes('pg_cancel_backend')) return { rows: sessions };
        cancelled.push(values[0] as number);
        return { rows: [{ cancelled: answers.shift() }] };
      });
    };
    afterEach(() => {
      jest.useRealTimers();
    });

    const restoreEnv = () => spawn.mock.calls[1][2].env as NodeJS.ProcessEnv;
    const polls = () =>
      watcher.query.mock.calls.filter(([sql]: [string]) => sql.includes('pg_stat_activity'));

    it('names the pg_restore session and watches it from a second connection to the target', async () => {
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      await jest.advanceTimersByTimeAsync(1_000);

      const applicationName = restoreEnv().PGAPPNAME;
      expect(applicationName).toMatch(/^envault-restore-[0-9a-f-]{36}$/);
      expect(MockClient).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 5432,
          user: 'postgres',
          database: 'target_db',
          password: 'secret',
        }),
      );
      expect(polls()[0][1]).toEqual([applicationName]);
      // No server-side lock_timeout is passed: pg_restore resets it to 0.
      expect(restoreEnv().PGOPTIONS).toBeUndefined();

      restoreProc.emit('close', 0);
      await result;
    });

    it('cancels the statement that waits on a lock for the whole RESTORE_LOCK_WAIT_TIMEOUT_MS and says so', async () => {
      strategy = buildWith(5_000);
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      const failure = result.catch((error: unknown) => error);
      sessions = [{ pid: 4242, statement_start: '2026-10-27 20:58:30.9+00' }];

      await jest.advanceTimersByTimeAsync(4_000);
      expect(cancelled).toEqual([]);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(cancelled).toEqual([4242]);
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('waited 5 s for a lock'));

      // The cancelled statement ends the single transaction and pg_restore exits with an error.
      restoreProc.stderr.emit(
        'data',
        Buffer.from('pg_restore: error: could not execute query: ERROR:  canceling statement due to user request'),
      );
      restoreProc.emit('close', 1);

      expect((await failure as Error).message).toBe(
        'Timed out after 5 s waiting for a lock on the target database; ' +
          'another session is using the target tables. The target was left unchanged.',
      );
    });

    it('keeps bounding the wait when the cancel does not apply, and cancels it on the next bound', async () => {
      strategy = buildWith(5_000);
      cancelAnswers(false, true);
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      const failure = result.catch((error: unknown) => error);
      sessions = [{ pid: 4242, statement_start: 'a' }];

      await jest.advanceTimersByTimeAsync(6_000);
      expect(cancelled).toEqual([4242]);
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('cancel did not apply'));
      await jest.advanceTimersByTimeAsync(6_000);
      expect(cancelled).toEqual([4242, 4242]);

      restoreProc.emit('close', 1);
      expect((await failure as Error).message).toContain('Timed out after 5 s waiting for a lock');
    });

    it('does not blame a lock wait for a failure that follows a cancel that did not apply', async () => {
      strategy = buildWith(5_000);
      cancelAnswers(false);
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      const failure = result.catch((error: unknown) => error);
      sessions = [{ pid: 4242, statement_start: 'a' }];

      await jest.advanceTimersByTimeAsync(6_000);
      restoreProc.stderr.emit('data', Buffer.from('pg_restore: error: could not execute query: ERROR:  deadlock detected'));
      restoreProc.emit('close', 1);

      const message = (await failure as Error).message;
      expect(message).toContain('pg_restore exited with code 1');
      expect(message).not.toContain('Timed out');
    });

    it('uses the default 30 s when RESTORE_LOCK_WAIT_TIMEOUT_MS is not set', async () => {
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      sessions = [{ pid: 7, statement_start: 'a' }];

      await jest.advanceTimersByTimeAsync(29_000);
      expect(cancelled).toEqual([]);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(cancelled).toEqual([7]);

      restoreProc.emit('close', 0);
      await result;
    });

    it('words a lock wait with a decimal when it is not a whole number of seconds', async () => {
      strategy = buildWith(1_500);
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      const failure = result.catch((error: unknown) => error);
      sessions = [{ pid: 7, statement_start: 'a' }];

      await jest.advanceTimersByTimeAsync(3_000);
      restoreProc.emit('close', 1);

      expect((await failure as Error).message).toContain('Timed out after 1.5 s');
    });

    it('does not cancel a wait that ends before the bound', async () => {
      strategy = buildWith(5_000);
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      sessions = [{ pid: 7, statement_start: 'a' }];
      await jest.advanceTimersByTimeAsync(3_000);
      sessions = [];
      await jest.advanceTimersByTimeAsync(3_000);
      // A new wait starts counting from zero.
      sessions = [{ pid: 7, statement_start: 'a' }];
      await jest.advanceTimersByTimeAsync(3_000);

      expect(cancelled).toEqual([]);
      restoreProc.emit('close', 0);
      await result;
    });

    it('does not add the waits of different statements together', async () => {
      strategy = buildWith(5_000);
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      for (const statement of ['a', 'b', 'c']) {
        sessions = [{ pid: 7, statement_start: statement }];
        await jest.advanceTimersByTimeAsync(2_000);
      }

      expect(cancelled).toEqual([]);
      restoreProc.emit('close', 0);
      await result;
    });

    it('keeps the generic message for a failure the watcher did not cause', async () => {
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      const failure = result.catch((error: unknown) => error);
      restoreProc.stderr.emit('data', Buffer.from('pg_restore: error: could not execute query: ERROR:  deadlock detected'));
      restoreProc.emit('close', 1);

      const message = (await failure as Error).message;
      expect(message).toContain('pg_restore exited with code 1');
      expect(message).not.toContain('Timed out');
    });

    it('stops watching and closes the second connection when pg_restore ends', async () => {
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      await jest.advanceTimersByTimeAsync(2_000);
      restoreProc.emit('close', 0);
      await result;
      await jest.advanceTimersByTimeAsync(0);
      const pollsAtEnd = polls().length;

      await jest.advanceTimersByTimeAsync(10_000);

      expect(polls()).toHaveLength(pollsAtEnd);
      expect(watcher.end).toHaveBeenCalledTimes(1);
    });

    it('lets the restore run unbounded, and says so, when the watcher cannot connect', async () => {
      watcher.connect.mockRejectedValue(new Error('too many connections'));
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      await jest.advanceTimersByTimeAsync(2_000);
      restoreProc.emit('close', 0);

      await expect(result).resolves.toBeUndefined();
      expect(polls()).toHaveLength(0);
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('lock wait is not being watched'));
    });

    it('keeps the restore running when a poll fails', async () => {
      const { result, restoreProc } = await startRestore(listing('17.11', '17.11'));
      watcher.query.mockRejectedValue(new Error('connection terminated'));
      await jest.advanceTimersByTimeAsync(2_000);
      restoreProc.emit('close', 0);

      await expect(result).resolves.toBeUndefined();
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining('lock wait is not being watched'));
    });
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
