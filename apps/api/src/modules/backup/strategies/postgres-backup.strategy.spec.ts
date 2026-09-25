/// <reference types="jest" />
import { EventEmitter } from 'events';
import { PostgresBackupStrategy } from './postgres-backup.strategy';
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

describe('PostgresBackupStrategy', () => {
  let mockR2Service: jest.Mocked<Partial<R2Service>>;

  const mockConnection = {
    id: 'conn-1',
    name: 'Production DB',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    database: 'prod_db',
    password: 'secret',
  } as ConnectionEntity;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('spawns pg_dump with custom format flags and uploads to R2', async () => {
    const strategy = new PostgresBackupStrategy(mockR2Service as R2Service);

    const mockProc = new EventEmitter() as MockChildProcess;
    mockProc.stdout = Object.assign(new EventEmitter(), { pipe: jest.fn() });
    mockProc.stderr = new EventEmitter();
    mockProc.kill = jest.fn();

    spawn.mockReturnValueOnce(mockProc);

    const executePromise = strategy.execute(mockConnection, 'backups/test.dump');

    // Simulate completion
    mockProc.emit('close', 0);

    const result = await executePromise;

    expect(spawn).toHaveBeenCalledWith(
      'pg_dump',
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
});
