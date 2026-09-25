/// <reference types="jest" />
import { EventEmitter } from 'events';
import { PostgresRestoreStrategy } from './postgres-restore.strategy';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

jest.mock('child_process');

const { spawn } = jest.requireMock('child_process');

type MockChildProcess = EventEmitter & {
  stderr: EventEmitter;
  kill?: jest.Mock;
};

describe('PostgresRestoreStrategy', () => {
  let strategy: PostgresRestoreStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new PostgresRestoreStrategy();
  });

  const mockConnection = {
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    database: 'target_db',
    password: 'secret',
  } as ConnectionEntity;

  it('fails restore if pg_restore -l preflight exits with non-zero code', async () => {
    const preflightProc = new EventEmitter() as MockChildProcess;
    preflightProc.stderr = new EventEmitter();

    spawn.mockReturnValueOnce(preflightProc);

    const onLog = jest.fn();
    const executePromise = strategy.execute(
      mockConnection,
      '/tmp/corrupt.dump',
      onLog,
    );

    preflightProc.stderr.emit(
      'data',
      Buffer.from('pg_restore: error: input file appears to be corrupted or truncated'),
    );
    preflightProc.emit('close', 1);

    await expect(executePromise).rejects.toThrow(
      'Preflight estructural falló: el dump está truncado o es inválido',
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('pg_restore', ['-l', '/tmp/corrupt.dump']);
  });

  it('runs pg_restore if preflight succeeds', async () => {
    const preflightProc = new EventEmitter() as MockChildProcess;
    preflightProc.stderr = new EventEmitter();

    const restoreProc = new EventEmitter() as MockChildProcess;
    restoreProc.stderr = new EventEmitter();
    restoreProc.kill = jest.fn();


    spawn
      .mockReturnValueOnce(preflightProc)
      .mockReturnValueOnce(restoreProc);

    const onLog = jest.fn();
    const executePromise = strategy.execute(
      mockConnection,
      '/tmp/valid.dump',
      onLog,
    );

    preflightProc.emit('close', 0);
    await Promise.resolve();
    restoreProc.emit('close', 0);

    await expect(executePromise).resolves.toBeUndefined();


    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(1, 'pg_restore', ['-l', '/tmp/valid.dump']);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'pg_restore',
      expect.arrayContaining(['-d', 'target_db', '/tmp/valid.dump']),
      expect.anything(),
    );
  });
});
