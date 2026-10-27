import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
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
const DEFAULT_RESTORE_LOCK_WAIT_TIMEOUT_MS = 30_000;

/** The lock watch is a side channel: it gives up on an unreachable target instead of holding the restore. */
const LOCK_WATCH_TIMEOUT_MS = 10_000;

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
  private readonly lockWaitMs: number;
  private readonly toolchain: PgToolchain;

  constructor(
    @Optional() configService?: ConfigService,
    @Optional() toolchain?: PgToolchain,
  ) {
    this.timeoutMs =
      configService?.get<number>('RESTORE_TIMEOUT_MS') ??
      DEFAULT_RESTORE_TIMEOUT_MS;
    this.lockWaitMs =
      configService?.get<number>('RESTORE_LOCK_WAIT_TIMEOUT_MS') ??
      DEFAULT_RESTORE_LOCK_WAIT_TIMEOUT_MS;
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
      let stopWatching: () => void = () => undefined;
      let lockWaitExceeded = false;
      const settle = (fn: typeof resolve | typeof reject, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        stopWatching();
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

      // The name tells the lock watcher which session is this restore's.
      const applicationName = `envault-restore-${randomUUID()}`;
      const pgRestore = spawn(pgRestoreBinary, args, {
        env: {
          ...process.env,
          PGPASSWORD: connection.password,
          PGAPPNAME: applicationName,
        },
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

      stopWatching = this.watchLockWait(connection, applicationName, onLog, (exceeded) => {
        lockWaitExceeded = exceeded;
      });

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
        } else if (lockWaitExceeded) {
          // The cancelled statement aborts the single transaction, which rolls
          // everything back, so the target is as it was.
          settle(
            reject,
            new Error(
              `Timed out after ${this.lockWaitSeconds()} s waiting for a lock on the target database; ` +
                'another session is using the target tables. The target was left unchanged.',
            ),
          );
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

  /**
   * Bounds how long the restore waits for a lock another session holds on the
   * target (RESTORE_LOCK_WAIT_TIMEOUT_MS), so it fails instead of waiting for as
   * long as that session keeps the lock.
   *
   * A server-side lock_timeout cannot do it: pg_restore starts every session with
   * `SET lock_timeout = 0`, which overrides PGOPTIONS and any role or database
   * setting. So a second connection watches the session (found by the
   * application name given to pg_restore) and cancels its statement once it has
   * waited on a lock for the whole bound. The restore runs in one transaction,
   * so the cancel rolls all of it back.
   *
   * Best effort: if the watcher cannot connect or a poll fails, the restore keeps
   * running without the bound and the job log says so.
   *
   * @param onExceeded called with true just before the cancel is sent, and with
   *   false if the cancel could not be sent or the server did not apply it.
   * @returns a function that stops the watch and closes its connection; calling
   *   it again is harmless.
   */
  private watchLockWait(
    connection: ConnectionEntity,
    applicationName: string,
    onLog: (message: string) => void,
    onExceeded: (exceeded: boolean) => void,
  ): () => void {
    const intervalMs = Math.min(1_000, Math.max(100, Math.floor(this.lockWaitMs / 10)));
    const client = new Client({
      host: connection.host,
      port: connection.port,
      database: connection.database,
      user: connection.username,
      password: connection.password,
      connectionTimeoutMillis: LOCK_WATCH_TIMEOUT_MS,
      query_timeout: LOCK_WATCH_TIMEOUT_MS,
    });
    // A socket reset after the connection is up is emitted as 'error'; without a
    // listener it would become an uncaughtException.
    client.on('error', (error: Error) => {
      this.logger.warn(`Lock watch connection error: ${sanitizeMessage(error.message)}`);
    });

    let halted = false;
    let polling = false;
    let timer: NodeJS.Timeout | undefined;
    let closing: Promise<void> | undefined;
    // The wait being timed: the same statement of the same session, found on a lock at every poll.
    let waiting: { pid: number; statement: string; since: number } | null = null;

    const halt = () => {
      halted = true;
      if (timer) clearInterval(timer);
    };
    const connected = client.connect();
    const close = () => {
      closing ??= connected.then(() => client.end()).catch(() => undefined);
    };
    const giveUp = (error: unknown) => {
      halt();
      close();
      onLog(
        `The lock wait is not being watched (${sanitizeMessage(error instanceof Error ? error.message : String(error))}): ` +
          'RESTORE_LOCK_WAIT_TIMEOUT_MS does not apply to this restore.',
      );
    };

    const poll = async () => {
      if (halted || polling) return;
      polling = true;
      try {
        const { rows } = await client.query<{ pid: number; statement_start: string }>(
          `SELECT pid, query_start::text AS statement_start
             FROM pg_stat_activity
            WHERE application_name = $1
              AND datname = current_database()
              AND wait_event_type = 'Lock'
            LIMIT 1`,
          [applicationName],
        );
        if (halted) return;

        const session = rows[0];
        if (!session) {
          waiting = null;
          return;
        }
        if (
          !waiting ||
          waiting.pid !== session.pid ||
          waiting.statement !== session.statement_start
        ) {
          waiting = { pid: session.pid, statement: session.statement_start, since: Date.now() };
          return;
        }
        if (Date.now() - waiting.since < this.lockWaitMs) return;

        onExceeded(true);
        onLog(
          `pg_restore waited ${this.lockWaitSeconds()} s for a lock held by another session; ` +
            'cancelling the restore, the target is left unchanged.',
        );
        try {
          const { rows: cancel } = await client.query<{ cancelled: boolean }>(
            'SELECT pg_cancel_backend($1) AS cancelled',
            [session.pid],
          );
          if (cancel[0]?.cancelled === true) {
            halt();
          } else {
            // The statement had left its wait, or the server did not apply the cancel: keep watching.
            onExceeded(false);
            waiting = null;
            onLog('The cancel did not apply; the lock wait is still being watched.');
          }
        } catch (error) {
          onExceeded(false);
          giveUp(error);
        }
      } catch (error) {
        if (!halted) giveUp(error);
      } finally {
        polling = false;
      }
    };

    connected.then(
      () => {
        if (halted) return;
        timer = setInterval(() => void poll(), intervalMs);
        timer.unref?.();
      },
      giveUp,
    );

    return () => {
      halt();
      close();
    };
  }

  /** The lock wait in seconds, with one decimal at most (1500 ms is "1.5"). */
  private lockWaitSeconds(): number {
    return Math.round(this.lockWaitMs / 100) / 10;
  }
}
