import type { ChildProcess } from 'child_process';
import { Logger } from '@nestjs/common';
import { ConnectionEntity } from '../../../database/entities/connection.entity';

const logger = new Logger('stopChildProcess');

/** How long a CLI gets to react to SIGTERM before it is killed. */
const CHILD_TERM_GRACE_MS = 5_000;
/** How long after SIGKILL a child that has not exited is reported as stuck. */
const CHILD_KILL_WAIT_MS = 5_000;

/**
 * Stops a CLI child (SIGTERM, then SIGKILL after a grace period) and resolves
 * once it has exited. A restore that is cancelled or out of time must not report
 * back while its CLI still runs: the caller then releases the target's advisory
 * lock and lease, and a live pg_restore or mysql would go on loading into a
 * target that another restore may already own.
 *
 * It never resolves before the child has exited: the safety of the target comes
 * before ending the job. A child still alive `killWaitMs` after SIGKILL is
 * logged once as a warning for the operator, and the wait goes on.
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

    let stuckTimer: NodeJS.Timeout | undefined;
    const done = () => {
      clearTimeout(forceTimer);
      clearTimeout(stuckTimer);
      child.off('exit', done);
      child.off('close', done);
      child.off('error', done);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL');
      stuckTimer = setTimeout(() => {
        logger.warn(
          `${child.spawnfile ?? 'Restore process'} (pid ${child.pid}) is still alive ${killWaitMs}ms after SIGKILL; the restore keeps waiting for it so the target is not released under a live process`,
        );
      }, killWaitMs);
      stuckTimer.unref?.();
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
