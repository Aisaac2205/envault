import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RETENTION_QUEUE_NAME, RETENTION_JOB_NAME } from './maintenance.constants';
import { MaintenanceService } from './maintenance.service';
import { BackupCategory } from '../../database/enums/backup-category.enum';
import { RetentionPolicy, CleanupResult } from './interfaces/retention.interface';

export interface RetentionJobPayload {
  connectionSlug: string;
  category: BackupCategory;
  policy: RetentionPolicy;
}

@Processor(RETENTION_QUEUE_NAME, { concurrency: 1 })
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(private readonly maintenanceService: MaintenanceService) {
    super();
  }

  async process(job: Job<RetentionJobPayload>): Promise<CleanupResult | undefined> {
    this.logger.log(
      `Processing retention job ${job.id} for "${job.data.connectionSlug}" (${job.data.category})`,
    );
    if (job.name === RETENTION_JOB_NAME) {
      return this.maintenanceService.applyRetention(
        job.data.connectionSlug,
        job.data.category,
        job.data.policy,
      );
    }
    return undefined;
  }
}
