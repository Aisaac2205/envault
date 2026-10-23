import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import {
  RestoreIncompatibleError,
  RestoreSourceInfo,
  RestoreStrategy,
} from '../interfaces/restore-strategy.interface';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';
import {
  ArchiveHeader,
  PgClientResolver,
  majorFromVersionString,
  parseArchiveHeader,
} from './pg-client-resolver';
import { PgToolchain } from './pg-toolchain';

const DEFAULT_RESTORE_TIMEOUT_MS = 1_800_000;

/**
 * Bound for the request-time version probe (connect and query each). The check
 * is best effort, so an unreachable target must not hold `POST /restores` for
 * the 10 s plus 10 s the worker allows itself; the worker repeats the check.
 */
const REQUEST_TIME_PROBE_TIMEOUT_MS = 3_000;

/** The version lines sit at the top of `pg_restore -l`; the rest is the table of contents. */
const ARCHIVE_HEADER_MAX_CHARS = 64 * 1024;

@Injectable()
export class PostgresRestoreStrategy implements RestoreStrategy {
  private readonly logger = new Logger(PostgresRestoreStrategy.name);
  private readonly timeoutMs: number;
  private readonly toolchain: PgToolchain;

  constructor(
    @Optional() configService?: ConfigService,
    @Optional() toolchain?: PgToolchain,
  ) {
    this.timeoutMs =
      configService?.get<number>('RESTORE_TIMEOUT_MS') ??
      DEFAULT_RESTORE_TIMEOUT_MS;
    this.toolchain = toolchain ?? new PgToolchain(configService);
  }

  /**
   * Request-time guard (see RestoreStrategy.assertCompatible): rejects what the
   * manifest and the target already prove, so an unsupported restore (a
   * downgrade, a target older than the oldest client) never becomes a job.
   * Anything it cannot establish here is re-checked by `execute` on the archive.
   */
  async assertCompatible(
    target: ConnectionEntity,
    source: RestoreSourceInfo,
  ): Promise<void> {
    let targetMajor: number;
    try {
      targetMajor = await this.toolchain.readServerMajor(target, {
        timeoutMs: REQUEST_TIME_PROBE_TIMEOUT_MS,
      });
    } catch (error) {
      this.logger.warn(
        `Skipping the request-time version check: ${sanitizeMessage(error instanceof Error ? error.message : String(error))}`,
      );
      return;
    }

    const plan = this.toolchain.resolver().planRestore({
      archive: {
        serverMajor: majorFromVersionString(source.serverVersion),
        dumpedByMajor: null,
      },
      targetMajor,
    });
    if (!plan.ok) {
      throw new RestoreIncompatibleError(plan.message);
    }
  }

  async execute(
    connection: ConnectionEntity,
    filePath: string,
    onLog: (message: string) => void,
    options?: { abortSignal?: AbortSignal },
  ): Promise<void> {
    const resolver = this.toolchain.resolver();
    const archive = await this.runPreflight(resolver, filePath, onLog, options?.abortSignal);

    const targetMajor = await this.readTargetMajor(connection);
    const plan = resolver.planRestore({ archive, targetMajor });
    if (!plan.ok) {
      throw new RestoreIncompatibleError(plan.message);
    }

    onLog(
      `Cliente de restauración: pg_restore ${plan.clientMajor} ` +
        `(archivo de PostgreSQL ${archive.serverMajor ?? '?'} generado con pg_dump ${archive.dumpedByMajor ?? '?'}, ` +
        `destino PostgreSQL ${targetMajor}).`,
    );
    if (plan.notice) {
      onLog(plan.notice);
    }

    if (options?.abortSignal?.aborted) {
      throw new Error('Operación cancelada por el usuario');
    }

    await this.runPgRestore(
      plan.binary,
      connection,
      filePath,
      onLog,
      options?.abortSignal,
    );
  }

  private async readTargetMajor(connection: ConnectionEntity): Promise<number> {
    try {
      return await this.toolchain.readServerMajor(connection);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `No se pudo determinar la versión de PostgreSQL del servidor de destino: ${sanitizeMessage(detail)}`,
      );
    }
  }

  /**
   * Lists the archive with the newest pg_restore (it reads every format) to
   * prove it is structurally valid and to read which server and which pg_dump
   * produced it. Nothing is touched on the target.
   */
  private runPreflight(
    resolver: PgClientResolver,
    filePath: string,
    onLog: (message: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<ArchiveHeader> {
    const listBinary = resolver.newestBinaryFor('pg_restore');
    return new Promise((resolve, reject) => {
      onLog('Ejecutando preflight estructural de dump (pg_restore -l)...');
      const proc = spawn(listBinary, ['-l', filePath]);
      let stderrOutput = '';
      let header = '';
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

      // The listing must be consumed or a large table of contents fills the
      // pipe and blocks pg_restore; only the head is kept, it holds the header.
      proc.stdout.on('data', (chunk: Buffer) => {
        if (header.length < ARCHIVE_HEADER_MAX_CHARS) {
          header += chunk.toString();
        }
      });

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
        settle(resolve, parseArchiveHeader(header));
      });
    });
  }

  private runPgRestore(
    pgRestoreBinary: string,
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

      const pgRestore = spawn(pgRestoreBinary, args, {
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
