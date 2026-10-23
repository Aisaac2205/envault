import { ConnectionEntity } from '../../../database/entities/connection.entity';

/**
 * The restore cannot work with the chosen source and target (for example a
 * PostgreSQL downgrade). It is deterministic and nothing was touched on the
 * target; the message is shown to the user as is.
 */
export class RestoreIncompatibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreIncompatibleError';
  }
}

export interface RestoreSourceInfo {
  /** `serverVersion` the backup manifest recorded for the source server. */
  serverVersion?: string | null;
}

export interface RestoreStrategy {
  execute(
    connection: ConnectionEntity,
    filePath: string,
    onLog: (message: string) => void,
    options?: { abortSignal?: AbortSignal },
  ): Promise<void>;

  /**
   * Early check run when a restore is requested, before a job is admitted.
   * Best effort: it only rejects what it can prove from the manifest and the
   * target; `execute` repeats the authoritative check on the archive itself.
   * @throws RestoreIncompatibleError when the restore cannot work.
   */
  assertCompatible?(
    target: ConnectionEntity,
    source: RestoreSourceInfo,
  ): Promise<void>;
}
