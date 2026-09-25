import { ConnectionEntity } from '../../../database/entities/connection.entity';

export interface BackupExecutionResult {
  fileSizeMb: number;
  sha256: string;
  bytes: number;
}

export interface BackupStrategy {
  execute(
    connection: ConnectionEntity,
    fileKey: string,
    metadata?: Record<string, string>,
    options?: { abortSignal?: AbortSignal },
  ): Promise<BackupExecutionResult>;
}


