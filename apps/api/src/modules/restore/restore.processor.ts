import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RESTORE_QUEUE_NAME } from './restore.constants';
import { RestoreService } from './restore.service';
import { CreateRestoreDto } from './dto/create-restore.dto';
import { AuthUser } from '../../auth/decorators/current-user.decorator';

export interface RestoreJobPayload {
  jobId: string;
  dto: CreateRestoreDto;
  user: AuthUser;
  leaseToken: string;
}

@Processor(RESTORE_QUEUE_NAME, { concurrency: 1 })
export class RestoreProcessor extends WorkerHost {
  private readonly logger = new Logger(RestoreProcessor.name);

  constructor(private readonly restoreService: RestoreService) {
    super();
  }

  async process(job: Job<RestoreJobPayload>): Promise<void> {
    const { jobId, dto, user, leaseToken } = job.data;
    this.logger.log(`Processing restore job ${jobId} from queue "${RESTORE_QUEUE_NAME}"`);

    await this.restoreService.executeRestoreAsync(jobId, dto, user, leaseToken);
  }
}
