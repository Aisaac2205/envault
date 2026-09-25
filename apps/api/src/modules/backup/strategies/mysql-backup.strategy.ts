import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { Transform } from 'stream';
import {
  BackupExecutionResult,
  BackupStrategy,
} from '../interfaces/backup-strategy.interface';
import { R2Service } from '../r2.service';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

const DEFAULT_BACKUP_TIMEOUT_MS = 1_800_000;

@Injectable()
export class MySQLBackupStrategy implements BackupStrategy {
  private readonly timeoutMs: number;

  constructor(
    private readonly r2Service: R2Service,
    @Optional() configService?: ConfigService,
  ) {
    this.timeoutMs =
      configService?.get<number>('BACKUP_TIMEOUT_MS') ??
      DEFAULT_BACKUP_TIMEOUT_MS;
  }

  execute(
    connection: ConnectionEntity,
    fileKey: string,
    metadata?: Record<string, string>,
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
        '-P', String(connection.port),
        '-u', connection.username,
        '--routines',
        '--triggers',
        '--events',
        '--single-transaction',
        '--no-tablespaces',
        '--set-gtid-purged=OFF',
        '--default-character-set=utf8mb4',
        connection.database,
      ];

      const mySqlDump = spawn('mysqldump', args, {
        env: { ...process.env, MYSQL_PWD: connection.password },
      });

      const timeout = setTimeout(() => {
        mySqlDump.kill();
        settle(reject, new Error(`mysqldump exceeded ${this.timeoutMs}ms timeout`));
      }, this.timeoutMs);

      let totalBytes = 0;
      const hash = createHash('sha256');
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          totalBytes += chunk.length;
          hash.update(chunk);
          cb(null, chunk);
        },
      });

      mySqlDump.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
      });

      mySqlDump.on('error', (err: Error) => {
        counter.destroy(err);
        settle(reject, new Error(`mysqldump failed to start: ${err.message}`));
      });

      mySqlDump.stdout.pipe(counter);

      uploadPromise = this.r2Service.upload(fileKey, counter, { metadata });

      mySqlDump.on('close', (code: number | null) => {
        if (code !== 0) {
          const detail = stderrBuffer.trim() || `exit code ${code ?? 'unknown'}`;
          counter.destroy(new Error(detail));
          settle(reject, new Error(`mysqldump failed: ${detail}`));
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

