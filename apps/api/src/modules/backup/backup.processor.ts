import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
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

  async process(job: Job<ProcessBackupJobData>): Promise<void> {
    this.logger.log(`Processing backup job ${job.data.jobId} from queue`);
    await this.backupService.executeQueuedBackup(job.data.jobId);
  }
}
