import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { BackupService } from './backup.service';
import { BACKUP_QUEUE_NAME } from './backup.constants';

export interface ProcessBackupJobData {
  jobId: string;
}

@Processor(BACKUP_QUEUE_NAME, {
  concurrency: 2,
})
export class BackupProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(private readonly backupService: BackupService) {
    super();
  }

  async process(job: Job<ProcessBackupJobData>, token?: string): Promise<void> {
    this.logger.log(`Processing backup job ${job.data.jobId} from queue`);

    const isRetry = job.attemptsMade > 0;
    const outcome = await this.backupService.executeQueuedBackup(job.data.jobId, {
      isRetry,
    });

    if (outcome.kind !== 'deferred') {
      return;
    }

    const delayMs = this.computeBusyBackoffMs(job);
    this.logger.log(
      `Connection busy for backup job ${job.data.jobId}. Deferring ${delayMs}ms without holding a worker slot.`,
    );
    await job.moveToDelayed(Date.now() + delayMs, token);
    throw new DelayedError();
  }

  /**
   * `min(300s, 30s * 2^n) * (0.8-1.2 jitter)`, with
   * `n = max(0, attemptsStarted - attemptsMade - 1)`. A deferral consumes no
   * attempt (only `attemptsStarted` grows), so a stall only inflates `n`,
   * and `n` is capped by the 300s ceiling.
   */
  private computeBusyBackoffMs(job: Job<ProcessBackupJobData>): number {
    const n = Math.max(0, job.attemptsStarted - job.attemptsMade - 1);
    const base = Math.min(300_000, 30_000 * 2 ** n);
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.round(base * jitter);
  }
}
