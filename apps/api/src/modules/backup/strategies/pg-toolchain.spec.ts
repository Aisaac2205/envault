/// <reference types="jest" />
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { R2Service } from '../r2.service';
import {
  DEFAULT_PG_CLIENT_BIN_ROOT,
  PgToolchain,
  discoverPgClients,
  probePathClient,
} from './pg-toolchain';
import { PostgresBackupStrategy } from './postgres-backup.strategy';
import { PostgresRestoreStrategy } from './postgres-restore.strategy';

jest.mock('child_process');
jest.mock('pg', () => ({ Client: jest.fn() }));

const { execFileSync } = jest.requireMock('child_process');
const { Client } = jest.requireMock('pg');

const EXE = process.platform === 'win32' ? '.exe' : '';

function installClient(root: string, major: string, tools = ['pg_dump', 'pg_restore']) {
  const binDir = path.join(root, major, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const tool of tools) {
    fs.writeFileSync(path.join(binDir, `${tool}${EXE}`), '#!/bin/sh\n', { mode: 0o755 });
  }
  return binDir;
}

describe('discoverPgClients', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-clients-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds every major that has pg_dump and pg_restore under <root>/<major>/bin', () => {
    installClient(root, '16');
    installClient(root, '18');
    installClient(root, '17');

    expect(discoverPgClients(root)).toEqual([
      { major: 16, binDir: path.join(root, '16', 'bin') },
      { major: 17, binDir: path.join(root, '17', 'bin') },
      { major: 18, binDir: path.join(root, '18', 'bin') },
    ]);
  });

  it('skips directories that are not a major, or that lack one of the two tools', () => {
    installClient(root, '17');
    installClient(root, '15', ['pg_dump']);
    installClient(root, 'common');
    fs.mkdirSync(path.join(root, '14'), { recursive: true });

    expect(discoverPgClients(root).map(({ major }) => major)).toEqual([17]);
  });

  it('returns nothing when the root does not exist', () => {
    expect(discoverPgClients(path.join(root, 'missing'))).toEqual([]);
  });
});

describe('probePathClient', () => {
  it('reads the major from `pg_dump --version` and trusts PATH for both tools', () => {
    const run = jest.fn().mockReturnValue('pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)\n');

    expect(probePathClient(run)).toEqual([{ major: 17, binDir: '' }]);
    expect(run).toHaveBeenCalledWith('pg_dump', ['--version']);
  });

  it('returns nothing when pg_dump is not on PATH', () => {
    const run = jest.fn().mockImplementation(() => {
      throw new Error('spawn pg_dump ENOENT');
    });

    expect(probePathClient(run)).toEqual([]);
  });

  it('returns nothing when the output has no version', () => {
    expect(probePathClient(jest.fn().mockReturnValue('unexpected'))).toEqual([]);
  });
});

describe('PgToolchain wiring', () => {
  it('is injected into both PostgreSQL strategies, as the backup module provides it', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PgToolchain,
        PostgresBackupStrategy,
        PostgresRestoreStrategy,
        { provide: R2Service, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    const toolchain = module.get(PgToolchain);
    expect((module.get(PostgresBackupStrategy) as unknown as { toolchain: PgToolchain }).toolchain).toBe(toolchain);
    expect((module.get(PostgresRestoreStrategy) as unknown as { toolchain: PgToolchain }).toolchain).toBe(toolchain);
  });
});

describe('PgToolchain', () => {
  let root: string;

  const configWith = (values: Record<string, string>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-toolchain-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('defaults to the Debian/PGDG layout', () => {
    expect(DEFAULT_PG_CLIENT_BIN_ROOT).toBe('/usr/lib/postgresql');
  });

  it('resolves the clients under PG_CLIENT_BIN_ROOT once and caches them', () => {
    installClient(root, '16');
    installClient(root, '18');
    const toolchain = new PgToolchain(configWith({ PG_CLIENT_BIN_ROOT: root }));

    const resolver = toolchain.resolver();

    expect(resolver.installedMajors).toEqual([16, 18]);
    expect(resolver.binaryFor('pg_dump', 16)).toBe(path.join(root, '16', 'bin', 'pg_dump'));
    expect(toolchain.resolver()).toBe(resolver);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('falls back to the client on PATH when the root holds no versioned clients', () => {
    execFileSync.mockReturnValue('pg_dump (PostgreSQL) 16.4\n');
    const toolchain = new PgToolchain(configWith({ PG_CLIENT_BIN_ROOT: root }));

    const resolver = toolchain.resolver();

    expect(resolver.installedMajors).toEqual([16]);
    expect(resolver.binaryFor('pg_restore', 16)).toBe('pg_restore');
  });

  it('has no clients when neither the root nor PATH provides one', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const toolchain = new PgToolchain(configWith({ PG_CLIENT_BIN_ROOT: root }));

    expect(toolchain.resolver().installedMajors).toEqual([]);
  });

  describe('readServerMajor', () => {
    const connection = {
      host: 'db.internal',
      port: 5433,
      username: 'app',
      database: 'appdb',
      password: 'secret',
    } as ConnectionEntity;

    // A real EventEmitter, like the pg Client: emitting 'error' with no listener throws.
    const mockClient = (query: jest.Mock) => {
      const client = Object.assign(new EventEmitter(), {
        connect: jest.fn().mockResolvedValue(undefined),
        query,
        end: jest.fn().mockResolvedValue(undefined),
      });
      Client.mockImplementation(() => client);
      return client;
    };

    it('reads the major from SHOW server_version_num and closes the client', async () => {
      const client = mockClient(
        jest.fn().mockResolvedValue({ rows: [{ server_version_num: '170011' }] }),
      );

      await expect(new PgToolchain().readServerMajor(connection)).resolves.toBe(17);

      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'db.internal',
          port: 5433,
          user: 'app',
          database: 'appdb',
          password: 'secret',
        }),
      );
      expect(client.query).toHaveBeenCalledWith('SHOW server_version_num');
      expect(client.end).toHaveBeenCalled();
    });

    it('uses the default 10 s timeouts, or the shorter one a caller asks for', async () => {
      mockClient(jest.fn().mockResolvedValue({ rows: [{ server_version_num: '170011' }] }));

      await new PgToolchain().readServerMajor(connection);
      expect(Client).toHaveBeenLastCalledWith(
        expect.objectContaining({ connectionTimeoutMillis: 10_000, query_timeout: 10_000 }),
      );

      await new PgToolchain().readServerMajor(connection, { timeoutMs: 3_000 });
      expect(Client).toHaveBeenLastCalledWith(
        expect.objectContaining({ connectionTimeoutMillis: 3_000, query_timeout: 3_000 }),
      );
    });

    it('survives a socket error emitted after connecting (no uncaught exception)', async () => {
      const client = mockClient(
        jest.fn().mockImplementation(async () => {
          // The server drops the idle socket right after the connection is up.
          expect(() => client.emit('error', new Error('read ECONNRESET'))).not.toThrow();
          return { rows: [{ server_version_num: '170011' }] };
        }),
      );

      await expect(new PgToolchain().readServerMajor(connection)).resolves.toBe(17);
      expect(client.listenerCount('error')).toBeGreaterThan(0);
    });

    it('closes the client and rethrows when the connection fails', async () => {
      const client = mockClient(jest.fn());
      client.connect.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(new PgToolchain().readServerMajor(connection)).rejects.toThrow(
        'connect ECONNREFUSED',
      );
      expect(client.end).toHaveBeenCalled();
    });

    it('rejects a reply that is not a version number', async () => {
      mockClient(jest.fn().mockResolvedValue({ rows: [{ server_version_num: 'weird' }] }));

      await expect(new PgToolchain().readServerMajor(connection)).rejects.toThrow(
        /server_version_num/,
      );
    });
  });
});
