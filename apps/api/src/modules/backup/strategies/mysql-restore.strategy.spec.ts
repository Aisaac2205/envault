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

function fakeMysqlProcess(exitCode: number): EventEmitter {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(),
  });
  setImmediate(() => child.emit('close', exitCode));
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

  it('never drops the pre-restore database when the rollback failed', async () => {
    swapMock.mockRejectedValue(
      new RestoreRollbackError('app_pre_restore_1', new Error('swap'), new Error('rollback')),
    );

    await expect(run()).rejects.toBeInstanceOf(RestoreRollbackError);

    expect(drops().some((s) => s.includes('_pre_restore_'))).toBe(false);
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
