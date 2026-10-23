import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';
import {
  PgClient,
  PgClientResolver,
  majorFromServerVersionNum,
} from './pg-client-resolver';

/** Where Debian / PGDG packages put each major: `<root>/<major>/bin/pg_dump`. */
export const DEFAULT_PG_CLIENT_BIN_ROOT = '/usr/lib/postgresql';

const VERSION_PROBE_TIMEOUT_MS = 5_000;
const SERVER_CONNECT_TIMEOUT_MS = 10_000;
const EXECUTABLE_SUFFIX = process.platform === 'win32' ? '.exe' : '';

function hasExecutable(dir: string, tool: string): boolean {
  try {
    fs.accessSync(path.join(dir, `${tool}${EXECUTABLE_SUFFIX}`), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Every `<root>/<major>/bin` that holds both pg_dump and pg_restore, oldest first. */
export function discoverPgClients(root: string): PgClient[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry): PgClient => ({
      major: Number(entry),
      binDir: path.join(root, entry, 'bin'),
    }))
    .filter(
      ({ binDir }) => hasExecutable(binDir, 'pg_dump') && hasExecutable(binDir, 'pg_restore'),
    )
    .sort((a, b) => a.major - b.major);
}

type RunTool = (file: string, args: string[]) => string;

const runTool: RunTool = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    timeout: VERSION_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/**
 * Single-client fallback for hosts without the versioned layout (a developer
 * running the API outside the image): the client on PATH, with the major read
 * from `pg_dump --version`. pg_restore is assumed to come from the same package.
 */
export function probePathClient(run: RunTool = runTool): PgClient[] {
  try {
    // "pg_dump (PostgreSQL) 17.2 (Debian 17.2-1.pgdg120+1)"
    const match = /PostgreSQL\)\s+(\d+)/.exec(run('pg_dump', ['--version']));
    return match ? [{ major: Number(match[1]), binDir: '' }] : [];
  } catch {
    return [];
  }
}

/**
 * Impure edge of the client selection: finds the installed pg_dump / pg_restore
 * majors and reads the version of a live server. The decisions themselves live
 * in the pure PgClientResolver.
 */
@Injectable()
export class PgToolchain implements OnModuleInit {
  private readonly logger = new Logger(PgToolchain.name);
  private cached: PgClientResolver | null = null;

  constructor(@Optional() private readonly configService?: ConfigService) {}

  onModuleInit(): void {
    const { installedMajors } = this.resolver();
    if (installedMajors.length === 0) {
      this.logger.error(
        'No PostgreSQL clients (pg_dump / pg_restore) were found: PostgreSQL backups and restores will fail.',
      );
      return;
    }
    this.logger.log(`PostgreSQL clients available: ${installedMajors.join(', ')}`);
  }

  /** Discovered on first use and cached for the life of the process. */
  resolver(): PgClientResolver {
    if (!this.cached) {
      const root =
        this.configService?.get<string>('PG_CLIENT_BIN_ROOT') || DEFAULT_PG_CLIENT_BIN_ROOT;
      const discovered = discoverPgClients(root);
      this.cached = new PgClientResolver(
        discovered.length > 0 ? discovered : probePathClient(),
      );
    }
    return this.cached;
  }

  /**
   * Major version of a live PostgreSQL server (`SHOW server_version_num`).
   * `timeoutMs` bounds the connection and the query (default 10 s); request-time
   * callers pass a shorter one so an unreachable server cannot stall a request.
   */
  async readServerMajor(
    connection: ConnectionEntity,
    options: { timeoutMs?: number } = {},
  ): Promise<number> {
    const timeoutMs = options.timeoutMs ?? SERVER_CONNECT_TIMEOUT_MS;
    const client = new Client({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
    });
    // A socket reset after the connection is up is emitted as 'error'. Without a
    // listener it becomes an uncaughtException, which the fatal runtime policy
    // turns into a process exit; the probe's own promise already reports failures.
    client.on('error', (error: Error) => {
      this.logger.warn(
        `PostgreSQL version probe connection error: ${sanitizeMessage(error.message)}`,
      );
    });

    try {
      await client.connect();
      const { rows } = await client.query<{ server_version_num: string }>(
        'SHOW server_version_num',
      );
      const major = majorFromServerVersionNum(rows[0]?.server_version_num);
      if (major === null) {
        throw new Error(
          `respuesta inválida de server_version_num: ${String(rows[0]?.server_version_num)}`,
        );
      }
      return major;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
