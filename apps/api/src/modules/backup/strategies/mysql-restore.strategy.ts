import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { createConnection as createMysqlConnection } from 'mysql2/promise';
import { RestoreStrategy, stopChildProcess } from '../interfaces/restore-strategy.interface';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';
import {
  RestoreRollbackError,
  listBaseTables,
  swapSchemaObjects,
  type MysqlSession,
} from './mysql-schema-objects';

const DEFAULT_RESTORE_TIMEOUT_MS = 1_800_000;
const DEFAULT_RESTORE_LOCK_WAIT_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
const CANCELLED_MESSAGE = 'Operación cancelada por el usuario';
/** MySQL's own bounds for lock_wait_timeout, in seconds (1 s to 1 year). */
const MIN_LOCK_WAIT_SECONDS = 1;
const MAX_LOCK_WAIT_SECONDS = 31_536_000;

@Injectable()
export class MySQLRestoreStrategy implements RestoreStrategy {
  private readonly logger = new Logger(MySQLRestoreStrategy.name);
  private readonly timeoutMs: number;
  private readonly lockWaitSeconds: number;

  constructor(@Optional() configService?: ConfigService) {
    this.timeoutMs =
      configService?.get<number>('RESTORE_TIMEOUT_MS') ??
      DEFAULT_RESTORE_TIMEOUT_MS;
    const lockWaitMs =
      configService?.get<number>('RESTORE_LOCK_WAIT_TIMEOUT_MS') ??
      DEFAULT_RESTORE_LOCK_WAIT_TIMEOUT_MS;
    this.lockWaitSeconds = Math.min(
      Math.max(Math.ceil(lockWaitMs / 1000), MIN_LOCK_WAIT_SECONDS),
      MAX_LOCK_WAIT_SECONDS,
    );
  }

  async execute(
    connection: ConnectionEntity,
    filePath: string,
    onLog: (message: string) => void,
    options?: { abortSignal?: AbortSignal },
  ): Promise<void> {
    if (options?.abortSignal?.aborted) {
      throw new Error('Operación cancelada por el usuario');
    }

    const ts = Date.now();
    const shadowDb = `${connection.database}_shadow_${ts}`;
    const backupDb = `${connection.database}_pre_restore_${ts}`;

    try {
      // Phase 1: restore into isolated shadow database
      onLog('Creating shadow database for safe restore...');
      await this.createDatabase(connection, shadowDb, options?.abortSignal);
      await this.runMysqlRestore(connection, filePath, onLog, shadowDb, options?.abortSignal);

      await this.withSession(connection, async (session) => {
        // Phase 2: validate shadow has base tables (views are not tables)
        const shadowTables = await listBaseTables(session, shadowDb);
        if (shadowTables.length === 0) {
          throw new Error('Restore produced no tables. Dump may be empty or corrupt');
        }
        onLog(`Shadow restore validated: ${shadowTables.length} tables`);

        // Phase 3: swap base tables atomically and recreate views, triggers,
        // routines and events around it (rolls back on failure)
        await this.createDatabase(connection, backupDb, options?.abortSignal);
        await swapSchemaObjects(session, {
          database: connection.database,
          shadowDb,
          backupDb,
          onLog,
          abortSignal: options?.abortSignal,
          lockWaitTimeoutSeconds: this.lockWaitSeconds,
        });
      });

      // Phase 4: cleanup
      await this.safeDropDatabase(connection, backupDb);
      await this.safeDropDatabase(connection, shadowDb);
      onLog('Restore completed successfully');
    } catch (error) {
      // The target is untouched or already rolled back, so the temp databases
      // can go. If the rollback itself failed, the pre-restore database holds
      // the original data and must survive, unless the rollback verified that
      // the tables never left the target and it is empty.
      await this.safeDropDatabase(connection, shadowDb);
      if (error instanceof RestoreRollbackError && !error.backupIsEmpty) {
        this.logger.error(
          `Rollback failed; database ${backupDb} was kept and may hold the original data`,
        );
      } else {
        if (error instanceof RestoreRollbackError) {
          this.logger.error(
            'Rollback failed before the tables moved; the target still holds its original tables',
          );
        }
        await this.safeDropDatabase(connection, backupDb);
      }
      throw error;
    }
  }

  private async withSession<T>(
    connection: ConnectionEntity,
    work: (session: MysqlSession) => Promise<T>,
  ): Promise<T> {
    const conn = await createMysqlConnection({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    // An error on the idle connection must not reach the process as an uncaughtException.
    conn.on('error', (error: Error) => {
      this.logger.warn(`Restore session error: ${sanitizeMessage(error.message)}`);
    });
    try {
      // Bounds every metadata lock wait of this session, the swap's DDL included.
      // Done server-side on purpose: a client-side query timeout would leave the
      // statement running on the server and make conn.end() wait behind it.
      await conn.query('SET SESSION lock_wait_timeout = ?', [this.lockWaitSeconds]);
      return await work({ query: (sql, values) => conn.query(sql, values) });
    } finally {
      await conn.end().catch(() => undefined);
    }
  }

  private executeSql(
    connection: ConnectionEntity,
    sql: string,
    database?: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: typeof resolve | typeof reject, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        (fn as (v?: unknown) => void)(value);
      };

      const args = [
        '-h',
        connection.host,
        '-P',
        String(connection.port),
        '-u',
        connection.username,
        database ?? connection.database,
        '-e',
        sql,
      ];

      // MYSQL_PWD keeps the password out of argv (not visible in ps aux / /proc).
      const child = spawn('mysql', args, {
        env: { ...process.env, MYSQL_PWD: connection.password },
      });

      // Rejects only once the child has exited (see stopChildProcess).
      let termination: Error | null = null;
      const terminate = (error: Error) => {
        if (settled) return;
        termination ??= error;
        void stopChildProcess(child).then(() => settle(reject, termination));
      };

      // A backstop with the same value as the deadline of the whole restore.
      const timeout = setTimeout(() => {
        terminate(new Error(`mysql execute exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

      if (abortSignal) {
        if (abortSignal.aborted) {
          terminate(new Error(CANCELLED_MESSAGE));
          return;
        }
        abortSignal.addEventListener('abort', () => terminate(new Error(CANCELLED_MESSAGE)), {
          once: true,
        });
      }

      let stderr = '';

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (error: Error) => {
        settle(reject, new Error(`mysql execute failed to start: ${error.message}`));
      });

      child.on('close', (code: number | null) => {
        if (termination) {
          settle(reject, termination);
          return;
        }
        if (code !== 0) {
          settle(
            reject,
            new Error(
              `mysql execute exited with code ${code ?? 'unknown'}: ${sanitizeMessage(stderr.trim())}`,
            ),
          );
          return;
        }
        settle(resolve);
      });
    });
  }

  private runMysqlRestore(
    connection: ConnectionEntity,
    filePath: string,
    onLog: (message: string) => void,
    database?: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: typeof resolve | typeof reject, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fileStream.destroy();
        (fn as (v?: unknown) => void)(value);
      };

      const args = [
        '-h',
        connection.host,
        '-P',
        String(connection.port),
        '-u',
        connection.username,
        database ?? connection.database,
      ];

      // Pipe the dump through stdin to avoid injection and force stream handling.
      const fileStream = createReadStream(filePath);
      fileStream.on('error', (err: Error) => {
        terminate(new Error(`Failed to read dump file: ${err.message}`));
      });

      // MYSQL_PWD keeps the password out of argv (not visible in ps aux / /proc).
      const mysqlChild = spawn('mysql', args, {
        env: { ...process.env, MYSQL_PWD: connection.password },
      });

      // Rejects only once the child has exited (see stopChildProcess).
      let termination: Error | null = null;
      function terminate(error: Error): void {
        if (settled) return;
        fileStream.destroy();
        termination ??= error;
        void stopChildProcess(mysqlChild).then(() => settle(reject, termination));
      }

      // A backstop with the same value as the deadline of the whole restore.
      const timeout = setTimeout(() => {
        terminate(new Error(`mysql restore exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

      if (abortSignal) {
        if (abortSignal.aborted) {
          terminate(new Error(CANCELLED_MESSAGE));
          return;
        }
        abortSignal.addEventListener('abort', () => terminate(new Error(CANCELLED_MESSAGE)), {
          once: true,
        });
      }

      fileStream.pipe(mysqlChild.stdin);

      mysqlChild.stderr.on('data', (chunk: Buffer) => {
        const lines = chunk
          .toString()
          .split('\n')
          .filter((line) => line.trim().length > 0);

        for (const line of lines) {
          onLog(line);
        }
      });

      mysqlChild.on('error', (error: Error) => {
        settle(reject, new Error(`mysql restore failed to start: ${error.message}`));
      });

      mysqlChild.on('close', (code: number | null) => {
        if (termination) {
          settle(reject, termination);
        } else if (code === 0) {
          settle(resolve);
        } else {
          settle(reject, new Error(`mysql restore exited with code ${code ?? 'unknown'}`));
        }
      });
    });
  }

  private async createDatabase(
    connection: ConnectionEntity,
    dbName: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const escaped = this.escapeId(dbName);
    await this.executeSql(
      connection,
      `DROP DATABASE IF EXISTS \`${escaped}\`; CREATE DATABASE \`${escaped}\``,
      undefined,
      abortSignal,
    );
  }

  private async safeDropDatabase(
    connection: ConnectionEntity,
    dbName: string,
  ): Promise<void> {
    try {
      await this.executeSql(
        connection,
        `DROP DATABASE IF EXISTS \`${this.escapeId(dbName)}\``,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to drop database ${dbName}: ${(err as Error).message}`,
      );
    }
  }

  private escapeId(identifier: string): string {
    return identifier.replace(/`/g, '``');
  }
}
