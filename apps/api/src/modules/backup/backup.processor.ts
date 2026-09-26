import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { BackupService } from './backup.service';
import { BackupRepository } from './backup.repository';
import { BACKUP_QUEUE_NAME } from './backup.constants';

export interface ProcessBackupJobData {
  jobId: string;
}

@Processor(BACKUP_QUEUE_NAME, {
  concurrency: 2,
})
export class BackupProcessor extends WorkerHost {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly backupRepository: BackupRepository,
  ) {
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

  /**
   * Covers `tryAcquire`/`moveToDelayed` throwing on a DB/Redis blip: that
   * exception never reaches `BackupService.executeQueuedBackup`'s own
   * catch block, so nothing marks the row FAILED and it would otherwise sit
   * PENDING/RUNNING until the next boot sweep. Fires after every failed
   * attempt (per BullMQ), so only act once the job will not be retried
   * again: either it just exhausted its last attempt, or the error is an
   * `UnrecoverableError` (no attempts left regardless of `attemptsMade`).
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessBackupJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;

    this.logger.error(`Backup job ${job.data.jobId} failed: ${error.message}`);

    const attempts = job.opts?.attempts ?? 1;
    const exhausted = error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    if (!exhausted) return;

    try {
      const markedFailed = await this.backupRepository.markFailedIfUnfinished(
        job.data.jobId,
        `Backup worker reportó una falla final tras ${job.attemptsMade} intento(s): ${error.message}`,
        new Date(),
      );
      if (markedFailed) {
        this.logger.warn(
          `Backup job ${job.data.jobId} quedó PENDING/RUNNING y fue marcado FAILED por el handler 'failed' del worker.`,
        );
      }
    } catch (repositoryError) {
      // This handler has no caller to propagate to — BullMQ just emits the
      // 'failed' event — so letting the repository error escape here becomes
      // an unhandled rejection that can crash the process. Log it and leave
      // the row for the next boot sweep (sweepOrphans) to reconcile instead.
      const message =
        repositoryError instanceof Error ? repositoryError.message : String(repositoryError);
      this.logger.error(
        `Failed to mark backup job ${job.data.jobId} as FAILED after its worker gave up: ${message}`,
      );
    }
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string, prev: string): void {
    this.logger.warn(`Backup job ${jobId} stalled (previo: ${prev})`);
  }
}
