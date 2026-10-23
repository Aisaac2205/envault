import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { Transform } from 'stream';
import {
  BackupExecutionResult,
  BackupStrategy,
} from '../interfaces/backup-strategy.interface';
import { R2Service } from '../r2.service';
import { ConnectionEntity } from '../../../database/entities/connection.entity';
import { sanitizeMessage } from '../../../common/sanitization/sanitize-message';
import { PgToolchain } from './pg-toolchain';

const DEFAULT_BACKUP_TIMEOUT_MS = 1_800_000;

@Injectable()
export class PostgresBackupStrategy implements BackupStrategy {
  private readonly logger = new Logger(PostgresBackupStrategy.name);
  private readonly timeoutMs: number;
  private readonly toolchain: PgToolchain;

  constructor(
    private readonly r2Service: R2Service,
    @Optional() configService?: ConfigService,
    @Optional() toolchain?: PgToolchain,
  ) {
    this.timeoutMs =
      configService?.get<number>('BACKUP_TIMEOUT_MS') ??
      DEFAULT_BACKUP_TIMEOUT_MS;
    this.toolchain = toolchain ?? new PgToolchain(configService);
  }

  async execute(
    connection: ConnectionEntity,
    fileKey: string,
    metadata?: Record<string, string>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<BackupExecutionResult> {
    if (options?.abortSignal?.aborted) {
      throw new Error('Operación cancelada por el usuario');
    }

    const pgDumpBinary = await this.selectPgDump(connection);
    return this.runPgDump(pgDumpBinary, connection, fileKey, metadata, options);
  }

  /**
   * Dumps with the pg_dump whose major equals the source server's: the archive
   * then loads into that same major or any newer one, which a newer pg_dump
   * cannot promise (it writes SETs and archive formats older servers reject).
   */
  private async selectPgDump(connection: ConnectionEntity): Promise<string> {
    let sourceMajor: number;
    try {
      sourceMajor = await this.toolchain.readServerMajor(connection);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `No se pudo determinar la versión de PostgreSQL del servidor de origen: ${sanitizeMessage(detail)}`,
      );
    }

    const plan = this.toolchain.resolver().planBackup(sourceMajor);
    if (!plan.ok) {
      // Deterministic: retrying the job cannot change the installed clients.
      throw new UnrecoverableError(plan.message);
    }

    this.logger.log(
      `Using pg_dump ${plan.clientMajor} for the PostgreSQL ${sourceMajor} source of connection ${connection.id}`,
    );
    return plan.binary;
  }

  private runPgDump(
    pgDumpBinary: string,
    connection: ConnectionEntity,
    fileKey: string,
    metadata?: Record<string, string>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<BackupExecutionResult> {
    return new Promise((resolve, reject) => {
      let stderrBuffer = '';
      let settled = false;
      let uploadPromise: Promise<void> | null = null;

      const settle = (fn: typeof resolve | typeof reject, value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        uploadPromise?.catch(() => {});
        (fn as (v: unknown) => void)(value);
      };

      const args = [
        '-h', connection.host,
        '-p', String(connection.port),
        '-U', connection.username,
        '-d', connection.database,
        '-F', 'c',
        '--no-password',
      ];

      const pgDump = spawn(pgDumpBinary, args, {
        env: { ...process.env, PGPASSWORD: connection.password },
      });

      if (options?.abortSignal) {
        if (options.abortSignal.aborted) {
          pgDump.kill();
          settle(reject, new Error('Operación cancelada por el usuario'));
          return;
        }
        options.abortSignal.addEventListener(
          'abort',
          () => {
            pgDump.kill();
            settle(reject, new Error('Operación cancelada por el usuario'));
          },
          { once: true },
        );
      }

      const timeout = setTimeout(() => {
        pgDump.kill();
        settle(reject, new Error(`pg_dump exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

      let totalBytes = 0;
      const hash = createHash('sha256');
      const counter = new Transform({
        highWaterMark: 64 * 1024,
        transform(chunk: Buffer, _enc, cb) {
          totalBytes += chunk.length;
          hash.update(chunk);
          cb(null, chunk);
        },
      });

      pgDump.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      pgDump.on('error', (err: Error) => {
        counter.destroy(err);
        settle(reject, new Error(`pg_dump failed to start: ${err.message}`));
      });

      pgDump.stdout.pipe(counter);

      uploadPromise = this.r2Service.upload(fileKey, counter, {
        metadata,
        abortSignal: options?.abortSignal,
      });

      pgDump.on('close', (code: number | null) => {
        if (code !== 0) {
          const detail = stderrBuffer.trim() || `exit code ${code ?? 'unknown'}`;
          counter.destroy(new Error(detail));
          settle(reject, new Error(`pg_dump failed: ${detail}`));
          return;
        }

        const sha256 = hash.digest('hex');
        uploadPromise!
          .then(() =>
            settle(resolve, {
              fileSizeMb: totalBytes / (1024 * 1024),
              sha256,
              bytes: totalBytes,
            }),
          )
          .catch((err: Error) => settle(reject, new Error(`R2 upload failed: ${err.message}`)));
      });
    });
  }
}

