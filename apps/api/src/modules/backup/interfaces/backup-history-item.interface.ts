import { Environment } from '../../../database/enums/environment.enum';
import { DbTypeEnum } from '../../../database/enums/db-type.enum';
import { JobStatus } from '../../../database/enums/job-status.enum';

export interface BackupHistoryItem {
  id: string;
  connectionId: string;
  connectionName: string;
  environment: Environment;
  dbType: DbTypeEnum | null;
  status: JobStatus;
  fileKey: string | null;
  fileSizeMb: number | null;
  sha256?: string | null;
  bytes?: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  triggeredBy: string;
  createdAt: Date;
}

