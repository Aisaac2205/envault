import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { Transform } from 'stream';
import {
  BackupExecutionResult,
  BackupStrategy,
} from '../interfaces/backup-strategy.interface';
import { R2Service } from '../r2.service';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

const BACKUP_TIMEOUT_MS = 600_000;

@Injectable()
export class MySQLBackupStrategy implements BackupStrategy {
  constructor(private readonly r2Service: R2Service) {}

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
        settle(reject, new Error(`mysqldump exceeded ${BACKUP_TIMEOUT_MS}ms timeout`));
      }, BACKUP_TIMEOUT_MS);

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

