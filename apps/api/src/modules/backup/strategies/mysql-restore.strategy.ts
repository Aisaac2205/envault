import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { RestoreStrategy } from '../interfaces/restore-strategy.interface';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';

const DEFAULT_RESTORE_TIMEOUT_MS = 1_800_000;

@Injectable()
export class MySQLRestoreStrategy implements RestoreStrategy {
  private readonly logger = new Logger(MySQLRestoreStrategy.name);
  private readonly timeoutMs: number;

  constructor(@Optional() configService?: ConfigService) {
    this.timeoutMs =
      configService?.get<number>('RESTORE_TIMEOUT_MS') ??
      DEFAULT_RESTORE_TIMEOUT_MS;
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
      await this.createDatabase(connection, shadowDb);
      await this.runMysqlRestore(connection, filePath, onLog, shadowDb, options?.abortSignal);

      // Phase 2: validate shadow has tables
      const shadowTables = await this.getTableNames(connection, shadowDb, options?.abortSignal);
      if (shadowTables.length === 0) {
        throw new Error('Restore produced no tables. Dump may be empty or corrupt');
      }
      onLog(`Shadow restore validated: ${shadowTables.length} tables`);

      // Phase 3: atomic swap: original->backup, shadow->original
      const originalTables = await this.getTableNames(connection, undefined, options?.abortSignal);
      await this.createDatabase(connection, backupDb);
      await this.atomicTableSwap(
        connection, shadowDb, backupDb, originalTables, shadowTables, onLog, options?.abortSignal,
      );

      // Phase 4: cleanup
      await this.safeDropDatabase(connection, backupDb);
      await this.safeDropDatabase(connection, shadowDb);
      onLog('Restore completed successfully');
    } catch (error) {
      // Original database is untouched, clean up temp databases
      await this.safeDropDatabase(connection, shadowDb);
      await this.safeDropDatabase(connection, backupDb);
      throw error;
    }
  }

  private getTableNames(
    connection: ConnectionEntity,
    database?: string,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: typeof resolve | typeof reject, value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        (fn as (v: unknown) => void)(value);
      };

      const args = [
        '-h',
        connection.host,
        '-P',
        String(connection.port),
        '-u',
        connection.username,
        '-N',
        '-B',
        '-e',
        'SHOW TABLES',
        database ?? connection.database,
      ];

      // MYSQL_PWD keeps the password out of argv (not visible in ps aux / /proc).
      const child = spawn('mysql', args, {
        env: { ...process.env, MYSQL_PWD: connection.password },
      });

      if (abortSignal) {
        if (abortSignal.aborted) {
          child.kill();
          settle(reject, new Error('Operación cancelada por el usuario'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            child.kill();
            settle(reject, new Error('Operación cancelada por el usuario'));
          },
          { once: true },
        );
      }

      const timeout = setTimeout(() => {
        child.kill();
        settle(reject, new Error(`mysql SHOW TABLES exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

      let stdout = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        this.logger.warn(`mysql SHOW TABLES stderr: ${chunk.toString().trim()}`);
      });

      child.on('error', (error: Error) => {
        settle(reject, new Error(`mysql SHOW TABLES failed to start: ${error.message}`));
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          settle(reject, new Error(`mysql SHOW TABLES exited with code ${code ?? 'unknown'}`));
          return;
        }

        const tables = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        settle(resolve, tables);
      });
    });
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

      if (abortSignal) {
        if (abortSignal.aborted) {
          child.kill();
          settle(reject, new Error('Operación cancelada por el usuario'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            child.kill();
            settle(reject, new Error('Operación cancelada por el usuario'));
          },
          { once: true },
        );
      }

      const timeout = setTimeout(() => {
        child.kill();
        settle(reject, new Error(`mysql execute exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

      let stderr = '';

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (error: Error) => {
        settle(reject, new Error(`mysql execute failed to start: ${error.message}`));
      });

      child.on('close', (code: number | null) => {
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
        mysqlChild.kill();
        settle(reject, new Error(`Failed to read dump file: ${err.message}`));
      });

      // MYSQL_PWD keeps the password out of argv (not visible in ps aux / /proc).
      const mysqlChild = spawn('mysql', args, {
        env: { ...process.env, MYSQL_PWD: connection.password },
      });

      if (abortSignal) {
        if (abortSignal.aborted) {
          fileStream.destroy();
          mysqlChild.kill();
          settle(reject, new Error('Operación cancelada por el usuario'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            fileStream.destroy();
            mysqlChild.kill();
            settle(reject, new Error('Operación cancelada por el usuario'));
          },
          { once: true },
        );
      }

      fileStream.pipe(mysqlChild.stdin);

      const timeout = setTimeout(() => {
        mysqlChild.kill();
        settle(reject, new Error(`mysql restore exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

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
        if (code === 0) {
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

  private async atomicTableSwap(
    connection: ConnectionEntity,
    shadowDb: string,
    backupDb: string,
    originalTables: string[],
    shadowTables: string[],
    onLog: (message: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const esc = (id: string) => this.escapeId(id);
    const origDb = connection.database;
    const renames: string[] = [];

    // Move original tables -> backup (preserves data for rollback)
    for (const t of originalTables) {
      renames.push(
        `\`${esc(origDb)}\`.\`${esc(t)}\` TO \`${esc(backupDb)}\`.\`${esc(t)}\``,
      );
    }

    // Move shadow tables -> original (the new data)
    for (const t of shadowTables) {
      renames.push(
        `\`${esc(shadowDb)}\`.\`${esc(t)}\` TO \`${esc(origDb)}\`.\`${esc(t)}\``,
      );
    }

    if (renames.length === 0) {
      onLog('No tables to swap');
      return;
    }

    // RENAME TABLE is atomic: all renames succeed or none do.
    const sql = [
      'SET FOREIGN_KEY_CHECKS = 0;',
      `RENAME TABLE ${renames.join(', ')};`,
      'SET FOREIGN_KEY_CHECKS = 1;',
    ].join('\n');

    await this.executeSql(connection, sql, undefined, abortSignal);
    onLog(
      `Swapped ${originalTables.length} original -> backup, ${shadowTables.length} shadow -> original`,
    );
  }

  private escapeId(identifier: string): string {
    return identifier.replace(/`/g, '``');
  }
}
