import type { ChildProcess } from 'child_process';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

/** How long a CLI gets to react to SIGTERM before it is killed. */
const CHILD_TERM_GRACE_MS = 5_000;
/** How long to wait for the exit after SIGKILL before giving up on it. */
const CHILD_KILL_WAIT_MS = 5_000;

/**
 * Stops a CLI child (SIGTERM, then SIGKILL after a grace period) and resolves
 * once it has exited. A restore that is cancelled or out of time must not report
 * back while its CLI still runs: the caller then releases the target's advisory
 * lock and lease, and a live pg_restore or mysql would go on loading into a
 * target that another restore may already own.
 *
 * Never waits for ever: if the child is still there a few seconds after
 * SIGKILL, it resolves anyway so the job can end.
 */
export function stopChildProcess(
  child: ChildProcess,
  graceMs = CHILD_TERM_GRACE_MS,
  killWaitMs = CHILD_KILL_WAIT_MS,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if ((child.exitCode ?? null) !== null || (child.signalCode ?? null) !== null) {
      resolve();
      return;
    }

    let giveUpTimer: NodeJS.Timeout | undefined;
    const done = () => {
      clearTimeout(forceTimer);
      clearTimeout(giveUpTimer);
      child.off('exit', done);
      child.off('close', done);
      child.off('error', done);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL');
      giveUpTimer = setTimeout(done, killWaitMs);
      giveUpTimer.unref?.();
    }, graceMs);
    forceTimer.unref?.();
    child.once('exit', done);
    child.once('close', done);
    child.once('error', done);
    child.kill('SIGTERM');
  });
}

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
