import { EventEmitter } from 'events';
import { PassThrough, Readable } from 'stream';

const spawnMock = jest.fn();
const createConnectionMock = jest.fn();
const swapMock = jest.fn();
const listBaseTablesMock = jest.fn();

jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));
jest.mock('fs', () => ({ createReadStream: () => Readable.from([]) }));
jest.mock('mysql2/promise', () => ({
  createConnection: (...args: unknown[]) => createConnectionMock(...args),
}));
jest.mock('./mysql-schema-objects', () => ({
  ...jest.requireActual('./mysql-schema-objects'),
  swapSchemaObjects: (...args: unknown[]) => swapMock(...args),
  listBaseTables: (...args: unknown[]) => listBaseTablesMock(...args),
}));

import { MySQLRestoreStrategy } from './mysql-restore.strategy';
import { RestoreRollbackError } from './mysql-schema-objects';
import type { ConfigService } from '@nestjs/config';
import type { ConnectionEntity } from '../../../database/entities/connection.entity';

const connection = {
  host: 'db',
  port: 3306,
  database: 'app',
  username: 'user',
  password: 'secret',
} as ConnectionEntity;

/** Every `mysql ... -e <sql>` the strategy ran, so drops can be asserted. */
let cliStatements: string[];

function fakeMysqlProcess(exitCode: number | null): EventEmitter & { kill: jest.Mock } {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  if (exitCode !== null) setImmediate(() => child.emit('close', exitCode));
  return child;
}

describe('MySQLRestoreStrategy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cliStatements = [];
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
      const e = args.indexOf('-e');
      if (e >= 0) cliStatements.push(args[e + 1]);
      return fakeMysqlProcess(0);
    });
    createConnectionMock.mockResolvedValue({
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
    });
    listBaseTablesMock.mockResolvedValue(['t']);
    swapMock.mockResolvedValue(undefined);
  });

  const run = (signal?: AbortSignal) =>
    new MySQLRestoreStrategy().execute(connection, '/tmp/dump.sql', jest.fn(), {
      abortSignal: signal,
    });

  const drops = () => cliStatements.filter((s) => s.startsWith('DROP DATABASE') && !s.includes('CREATE'));

  it('swaps through the schema-object swap and drops both temp databases on success', async () => {
    await run();

    expect(swapMock).toHaveBeenCalledTimes(1);
    expect(swapMock.mock.calls[0][1]).toMatchObject({ database: 'app' });
    expect(drops()).toHaveLength(2);
    expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
    expect(drops().some((s) => s.includes('_pre_restore_'))).toBe(true);
  });

  it('refuses a dump that produced no base tables and leaves the target untouched', async () => {
    listBaseTablesMock.mockResolvedValue([]);

    await expect(run()).rejects.toThrow('Restore produced no tables');

    expect(swapMock).not.toHaveBeenCalled();
    expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
  });

  it('drops both temp databases when the swap failed and was rolled back', async () => {
    swapMock.mockRejectedValue(new Error('swap failed'));

    await expect(run()).rejects.toThrow('swap failed');

    expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
    expect(drops().some((s) => s.includes('_pre_restore_'))).toBe(true);
  });

  it.each([
    ['after the tables moved', { renamed: true }],
    ['when the state is unknown', {}],
  ])('never drops the pre-restore database when the rollback failed %s', async (_label, state) => {
    swapMock.mockRejectedValue(
      new RestoreRollbackError('app_pre_restore_1', new Error('swap'), new Error('rollback'), state),
    );

    await expect(run()).rejects.toBeInstanceOf(RestoreRollbackError);

    expect(drops().some((s) => s.includes('_pre_restore_'))).toBe(false);
    expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
  });

  it('drops the pre-restore database when the rollback failed before the tables moved', async () => {
    swapMock.mockRejectedValue(
      new RestoreRollbackError('app_pre_restore_1', new Error('swap'), new Error('rollback'), {
        renamed: false,
      }),
    );

    await expect(run()).rejects.toBeInstanceOf(RestoreRollbackError);

    // The originals never left the target, so the pre-restore database is empty.
    expect(drops().some((s) => s.includes('_pre_restore_'))).toBe(true);
    expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
  });

  describe('lock wait bound on the swap session', () => {
    const sessionWith = (query: jest.Mock) => ({
      on: jest.fn(),
      end: jest.fn().mockResolvedValue(undefined),
      query,
    });
    const configured = (ms?: number) =>
      ({ get: (key: string) => (key === 'RESTORE_LOCK_WAIT_TIMEOUT_MS' ? ms : undefined) }) as ConfigService;

    it('sets lock_wait_timeout before any other statement and tells the swap its value', async () => {
      const conn = sessionWith(jest.fn().mockResolvedValue([[], []]));
      createConnectionMock.mockResolvedValue(conn);

      await run();

      expect(conn.query).toHaveBeenNthCalledWith(1, 'SET SESSION lock_wait_timeout = ?', [30]);
      expect(conn.query.mock.invocationCallOrder[0]).toBeLessThan(swapMock.mock.invocationCallOrder[0]);
      expect(swapMock.mock.calls[0][1]).toMatchObject({ lockWaitTimeoutSeconds: 30 });
      // A client-side query timeout would leave the statement running on the server.
      expect(createConnectionMock.mock.calls[0][0]).not.toHaveProperty('timeout');
    });

    it.each([
      [1_000, 1],
      [1_001, 2],
      [90_000, 90],
      [500, 1],
      [99_999_999_999, 31_536_000],
    ])('turns RESTORE_LOCK_WAIT_TIMEOUT_MS=%p into %p whole seconds', async (ms, seconds) => {
      const conn = sessionWith(jest.fn().mockResolvedValue([[], []]));
      createConnectionMock.mockResolvedValue(conn);

      await new MySQLRestoreStrategy(configured(ms)).execute(connection, '/tmp/dump.sql', jest.fn());

      expect(conn.query).toHaveBeenNthCalledWith(1, 'SET SESSION lock_wait_timeout = ?', [seconds]);
    });

    it('closes the session and never swaps when the limit cannot be set', async () => {
      const conn = sessionWith(jest.fn().mockRejectedValue(new Error('SET denied')));
      createConnectionMock.mockResolvedValue(conn);

      await expect(run()).rejects.toThrow('SET denied');

      expect(conn.end).toHaveBeenCalledTimes(1);
      expect(swapMock).not.toHaveBeenCalled();
      expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
    });
  });

  // A restore that is cancelled or out of time must not report back while a
  // mysql CLI is still running: the caller releases the target's advisory lock
  // and lease as soon as it hears.
  describe('stopping the mysql CLI', () => {
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
    /** The Nth spawned `mysql` stays alive until the test lets it exit. */
    const hangOn = (nth: number) => {
      const hung: ReturnType<typeof fakeMysqlProcess>[] = [];
      let spawned = 0;
      spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        spawned += 1;
        const e = args.indexOf('-e');
        if (e >= 0) cliStatements.push(args[e + 1]);
        if (spawned !== nth) return fakeMysqlProcess(0);
        const child = fakeMysqlProcess(null);
        hung.push(child);
        return child;
      });
      return hung;
    };
    /** The fake CLIs close on a real setImmediate, so let the event loop turn as well as the fake clock. */
    const turns = async (count = 5) => {
      for (let i = 0; i < count; i += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        await jest.advanceTimersByTimeAsync(0);
      }
    };
    const exit = (child: EventEmitter) => {
      child.emit('exit', null, 'SIGTERM');
      child.emit('close', null);
    };

    it('waits for the CREATE DATABASE of the shadow to exit after a cancel, and rejects with the cancel', async () => {
      const creating = hangOn(1);
      const controller = new AbortController();
      const state = outcome(run(controller.signal));
      await turns();

      controller.abort();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(creating[0].kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.settled).toBe(false);

      exit(creating[0]);
      await turns();

      expect(state.error?.message).toBe('Operación cancelada por el usuario');
      // The cleanup still runs: the shadow database is dropped.
      expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
    });

    it('waits for the shadow load to exit after a cancel', async () => {
      const hung = hangOn(2);
      const controller = new AbortController();
      const state = outcome(run(controller.signal));
      await turns();

      controller.abort();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(hung[0].kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.settled).toBe(false);

      exit(hung[0]);
      await turns();
      expect(state.error?.message).toBe('Operación cancelada por el usuario');
    });

    it('kills a mysql CLI that ignores SIGTERM, and keeps waiting for one that survives SIGKILL', async () => {
      const hung = hangOn(2);
      const controller = new AbortController();
      const state = outcome(run(controller.signal));
      await turns();

      controller.abort();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(hung[0].kill).toHaveBeenCalledWith('SIGKILL');
      expect(state.settled).toBe(false);

      await jest.advanceTimersByTimeAsync(10 * 60_000);
      await turns();
      expect(state.settled).toBe(false);

      exit(hung[0]);
      await turns();
      expect(state.error?.message).toBe('Operación cancelada por el usuario');
    });

    it('waits for the exit when the per-step timeout fires, for the load and for a statement', async () => {
      const config = {
        get: (key: string) => (key === 'RESTORE_TIMEOUT_MS' ? 10_000 : undefined),
      } as ConfigService;
      const hung = hangOn(2);
      const state = outcome(new MySQLRestoreStrategy(config).execute(connection, '/tmp/dump.sql', jest.fn()));
      await turns();

      await jest.advanceTimersByTimeAsync(10_000);
      expect(hung[0].kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.settled).toBe(false);

      exit(hung[0]);
      await turns();
      expect(state.error?.message).toBe('mysql restore exceeded 10000ms timeout');

      const statement = hangOn(1);
      const second = outcome(new MySQLRestoreStrategy(config).execute(connection, '/tmp/dump.sql', jest.fn()));
      await turns();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(statement[0].kill).toHaveBeenCalledWith('SIGTERM');
      expect(second.settled).toBe(false);

      exit(statement[0]);
      await turns();
      expect(second.error?.message).toBe('mysql execute exceeded 10000ms timeout');
    });

    it('hands the signal to the CREATE DATABASE of the pre-restore database', async () => {
      // 1: shadow create, 2: shadow load, 3: pre-restore create.
      const hung = hangOn(3);
      const controller = new AbortController();
      const state = outcome(run(controller.signal));
      await turns(8);
      expect(hung).toHaveLength(1);

      controller.abort();
      await jest.advanceTimersByTimeAsync(1_000);

      expect(hung[0].kill).toHaveBeenCalledWith('SIGTERM');
      expect(state.settled).toBe(false);
      exit(hung[0]);
      await turns();
      expect(state.error?.message).toBe('Operación cancelada por el usuario');
      expect(swapMock).not.toHaveBeenCalled();
    });
  });

  it('propagates a connect failure, never swaps and only drops what it created', async () => {
    const connectError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
      code: 'ECONNREFUSED',
      fatal: true,
    });
    createConnectionMock.mockRejectedValue(connectError);

    await expect(run()).rejects.toBe(connectError);

    expect(listBaseTablesMock).not.toHaveBeenCalled();
    expect(swapMock).not.toHaveBeenCalled();
    // The session never opened, so the pre-restore database was never created
    // and the target holds all of its data: only the shadow has anything to drop.
    expect(cliStatements.filter((s) => s.includes('CREATE DATABASE'))).toHaveLength(1);
    expect(cliStatements.some((s) => s.includes('CREATE DATABASE') && s.includes('_pre_restore_'))).toBe(false);
    expect(drops().some((s) => s.includes('_shadow_'))).toBe(true);
    expect(drops().some((s) => s.includes('_pre_restore_'))).toBe(true);
    expect(drops().every((s) => s.includes('IF EXISTS'))).toBe(true);
  });

  it('does nothing when cancelled before it starts', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(run(controller.signal)).rejects.toThrow('Operación cancelada por el usuario');

    expect(spawnMock).not.toHaveBeenCalled();
    expect(createConnectionMock).not.toHaveBeenCalled();
  });
});
