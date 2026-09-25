import { JobStatus } from '../../../database/enums/job-status.enum';

export interface BackupResult {
  jobId: string;
  fileKey: string;
  fileSizeMb?: number;
  sha256?: string;
  bytes?: number;
  startedAt?: Date;
  completedAt?: Date;
  status?: JobStatus;
}
