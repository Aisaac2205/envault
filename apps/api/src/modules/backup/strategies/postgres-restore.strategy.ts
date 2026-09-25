import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { RestoreStrategy } from '../interfaces/restore-strategy.interface';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';

const DEFAULT_RESTORE_TIMEOUT_MS = 1_800_000;

@Injectable()
export class PostgresRestoreStrategy implements RestoreStrategy {
  private readonly logger = new Logger(PostgresRestoreStrategy.name);
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
    await this.runPreflight(filePath, onLog, options?.abortSignal);
    await this.runPgRestore(connection, filePath, onLog, options?.abortSignal);
  }

  private runPreflight(
    filePath: string,
    onLog: (message: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      onLog('Ejecutando preflight estructural de dump (pg_restore -l)...');
      const proc = spawn('pg_restore', ['-l', filePath]);
      let stderrOutput = '';
      let settled = false;

      const settle = (fn: typeof resolve | typeof reject, value?: unknown) => {
        if (settled) return;
        settled = true;
        (fn as (v?: unknown) => void)(value);
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          proc.kill();
          settle(reject, new Error('Operación cancelada por el usuario'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            proc.kill();
            settle(reject, new Error('Operación cancelada por el usuario'));
          },
          { once: true },
        );
      }

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      proc.on('error', (err: Error) => {
        settle(
          reject,
          new Error(`Fallo al ejecutar preflight pg_restore: ${err.message}`),
        );
      });

      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          const detail = sanitizeMessage(
            stderrOutput.trim() || `exit code ${code ?? 'unknown'}`,
          );
          settle(
            reject,
            new Error(
              `Preflight estructural falló: el dump está truncado o es inválido (${detail})`,
            ),
          );
          return;
        }
        onLog('Preflight estructural completado exitosamente.');
        settle(resolve);
      });
    });
  }

  private runPgRestore(
    connection: ConnectionEntity,
    filePath: string,
    onLog: (message: string) => void,
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
        '-p',
        String(connection.port),
        '-U',
        connection.username,
        '-d',
        connection.database,
        '--no-owner',
        '--no-privileges',
        '--clean',
        '--if-exists',
        '--single-transaction',
        filePath,
      ];

      const pgRestore = spawn('pg_restore', args, {
        env: { ...process.env, PGPASSWORD: connection.password },
      });

      if (abortSignal) {
        if (abortSignal.aborted) {
          pgRestore.kill();
          settle(reject, new Error('Operación cancelada por el usuario'));
          return;
        }
        abortSignal.addEventListener(
          'abort',
          () => {
            pgRestore.kill();
            settle(reject, new Error('Operación cancelada por el usuario'));
          },
          { once: true },
        );
      }

      const timeout = setTimeout(() => {
        pgRestore.kill();
        settle(
          reject,
          new Error(`pg_restore exceeded ${this.timeoutMs}ms timeout`),
        );
      }, this.timeoutMs);

      let stderrOutput = '';

      pgRestore.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrOutput += text;
        const lines = text
          .split('\n')
          .filter((line) => line.trim().length > 0);

        for (const line of lines) {
          onLog(line);
        }
      });

      pgRestore.on('error', (error: Error) => {
        settle(reject, new Error(`pg_restore failed to start: ${error.message}`));
      });

      pgRestore.on('close', (code: number | null) => {
        if (code === 0) {
          settle(resolve);
        } else {
          const errorDetail =
            sanitizeMessage(stderrOutput.trim()) || `exit code ${code ?? 'unknown'}`;
          settle(
            reject,
            new Error(`pg_restore exited with code ${code ?? 'unknown'}: ${errorDetail}`),
          );
        }
      });
    });
  }
}
