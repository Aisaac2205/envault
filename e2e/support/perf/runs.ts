import type { APIRequestContext } from '@playwright/test';
import { assertOk, deleteConnection } from '../api';
import type { TestDatabase } from '../pipeline-fixtures';
import type { Connection } from '../fixtures';
import { manifestKey, type BackupJob, type JobRunner, type RestoreJob, type RestoreRequest } from '../jobs';
import { deleteObjects } from '../storage';

/**
 * The few steps every performance spec repeats: run a job and time it from the
 * outside, and clear away what a repetition created so the next one starts from
 * the same state and the stack is left empty.
 */

/** One line of progress on the runner's output, so a long run shows it is alive. */
export function progress(message: string): void {
  console.log(`[perf] ${message}`);
}

/** Runs `step` and returns its result together with the milliseconds it took. */
export async function timed<T>(step: () => Promise<T>): Promise<{ result: T; wallMs: number }> {
  const began = performance.now();
  const result = await step();
  return { result, wallMs: performance.now() - began };
}

/** Requests a backup and waits for it; `wallMs` runs from before the request to the poll that saw it done. */
export async function timedBackup(
  jobs: JobRunner,
  connectionId: string,
  timeoutMs: number,
): Promise<{ job: BackupJob; wallMs: number }> {
  const { result, wallMs } = await timed(async () => {
    const { jobId } = await jobs.startBackup(connectionId);
    return jobs.waitForBackup(jobId, { timeoutMs });
  });
  return { job: result, wallMs };
}

export async function timedRestore(
  jobs: JobRunner,
  request: RestoreRequest,
  timeoutMs: number,
): Promise<{ job: RestoreJob; wallMs: number }> {
  const { result, wallMs } = await timed(async () => {
    const { jobId } = await jobs.startRestore(request);
    return jobs.waitForRestore(jobId, { timeoutMs });
  });
  return { job: result, wallMs };
}

/** Deletes the dump of a backup and its manifest from object storage. */
export async function removeDumps(backups: readonly Pick<BackupJob, 'fileKey'>[]): Promise<void> {
  const keys = backups.flatMap(({ fileKey }) => (fileKey ? [fileKey, manifestKey(fileKey)] : []));
  await deleteObjects(keys);
}

/**
 * Drops a restore target as soon as its repetition is over, instead of at the
 * end of the case: four copies of a 500 MiB database would otherwise pile up.
 * The fixtures that created it still clean up after a failure.
 */
export async function discardTarget(
  api: APIRequestContext,
  target: { database: TestDatabase; connection: Connection },
): Promise<void> {
  await assertOk(await deleteConnection(api, target.connection), `Deleting connection ${target.connection.name}`);
  await target.database.engine.drop(target.database.name);
}
