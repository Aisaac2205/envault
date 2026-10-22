import type { APIRequestContext } from '@playwright/test';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertOk } from './api';
import { expectSuccessEnvelope } from './envelope';
import { deleteObjects } from './storage';

/**
 * Backup and restore jobs are asynchronous: the API answers 202 with a job id
 * and a worker does the rest. These helpers start jobs, wait for them with a
 * deadline and a message that says what went wrong, and clean up after a test.
 */

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface JobBase {
  id: string;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  createdAt: string;
}

/** `GET /backups/:id`, `GET /jobs/backups/:id`: a row of `backup_jobs`. */
export interface BackupJob extends JobBase {
  connectionId: string;
  connectionName?: string | null;
  environment: 'prod' | 'dev' | 'qa';
  dbType: 'postgres' | 'mysql' | null;
  fileKey: string | null;
  storageKeyVersion: number;
  category: string | null;
  fileSizeMb: number | null;
  sha256: string | null;
  bytes: number | null;
}

/** `GET /restores/:id`, `GET /jobs/restores/:id`: a row of `restore_jobs`. */
export interface RestoreJob extends JobBase {
  sourceBackupId: string | null;
  r2Key: string | null;
  targetConnectionId: string;
  targetEnvironment: 'prod' | 'dev' | 'qa';
  isDryRun: boolean;
}

interface DryRunSnapshot {
  tableCount: number;
  estimatedRows: number;
  tables: { name: string; estimatedRows: number }[];
}

interface DryRunConnection {
  name: string;
  database: string;
  environment: string;
  dbType: string;
}

export interface DryRunResult {
  source: DryRunSnapshot | null;
  target: DryRunSnapshot;
  diff: {
    added: string[];
    removed: string[];
    common: { name: string; sourceRows: number; targetRows: number }[];
  } | null;
  manifestAvailable: boolean;
  sourceConnection?: DryRunConnection;
  targetConnection: DryRunConnection;
}

export interface RestoreRequest {
  /** A completed backup job. Use this or `r2Key`. */
  sourceBackupId?: string;
  /** The object key of a dump. Use this or `sourceBackupId`. */
  r2Key?: string;
  targetConnectionId: string;
  isDryRun?: boolean;
}

type JobKind = 'backups' | 'restores';

const NOUN: Record<JobKind, string> = { backups: 'Backup', restores: 'Restore' };
const POLL_INTERVAL_MS = 250;

/**
 * Generous on purpose: the seeded datasets take well under a second, but a job
 * waits in the queue behind the others of a parallel run, and a failing backup
 * is retried after a 5 s backoff.
 */
export const JOB_TIMEOUT_MS = 60_000;

export interface WaitOptions<T> {
  /** What counts as done; by default the job is `completed`. */
  until?: (job: T) => boolean;
  /** Finishes the sentence "did not ..." in the timeout message. */
  description?: string;
  /**
   * Throw as soon as the job is `failed` without `until` accepting it, with the
   * job's own error message; on by default. A spec that expects the failure
   * turns it off.
   */
  failFast?: boolean;
  timeoutMs?: number;
}

/**
 * Polls a job until `until` accepts it. It never gives up silently: a job that
 * fails or does not finish in time ends in an error that carries its status and
 * `errorMessage`.
 */
export async function waitForJob<T extends JobBase>(
  api: APIRequestContext,
  kind: JobKind,
  id: string,
  options: WaitOptions<T> = {},
): Promise<T> {
  const {
    until = (job: T) => job.status === 'completed',
    description = 'complete',
    failFast = true,
    timeoutMs = JOB_TIMEOUT_MS,
  } = options;
  const noun = NOUN[kind];
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;

  do {
    const response = await api.get(`${kind}/${id}`);
    await assertOk(response, `Reading ${noun.toLowerCase()} job ${id}`);
    last = ((await response.json()) as { data: T }).data;

    if (until(last)) {
      return last;
    }
    if (failFast && last.status === 'failed') {
      throw new Error(`${noun} job ${id} failed: ${last.errorMessage ?? '(no error message)'}`);
    }
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new Error(
    `${noun} job ${id} did not ${description} within ${timeoutMs / 1000} s ` +
      `(last status: ${last.status}, error: ${last.errorMessage ?? 'none'}).`,
  );
}

/** Where a dump's manifest is stored: next to it, with the extension swapped. */
export const manifestKey = (fileKey: string): string => fileKey.replace(/\.dump$/, '.manifest.json');

/**
 * Starts and follows the backup and restore jobs of one test, and remembers
 * them so `cleanUp` can stop what is still queued or running and delete the
 * objects they stored. There is no endpoint that deletes a job row, so the rows
 * stay (as `completed` or `failed`) until the stack is reset.
 */
export class JobRunner {
  private readonly backupIds = new Set<string>();
  private readonly restoreIds = new Set<string>();
  private readonly fileKeys = new Set<string>();

  constructor(private readonly api: APIRequestContext) {}

  async startBackup(connectionId: string): Promise<{ jobId: string; fileKey: string; status: JobStatus }> {
    const response = await this.api.post('backups', { data: { connectionId } });
    const started = await expectSuccessEnvelope<{ jobId: string; fileKey: string; status: JobStatus }>(
      response,
      202,
    );
    this.backupIds.add(started.jobId);
    this.fileKeys.add(started.fileKey);
    return started;
  }

  /** Takes over a backup that something else started (a page, say), so `cleanUp` handles it too. */
  track(backup: { id: string; fileKey: string | null }): void {
    this.backupIds.add(backup.id);
    if (backup.fileKey) {
      this.fileKeys.add(backup.fileKey);
    }
  }

  waitForBackup(jobId: string, options?: WaitOptions<BackupJob>): Promise<BackupJob> {
    return waitForJob<BackupJob>(this.api, 'backups', jobId, options);
  }

  /** Starts a backup and waits until it is `completed`. */
  async backup(connectionId: string): Promise<BackupJob> {
    const { jobId } = await this.startBackup(connectionId);
    return this.waitForBackup(jobId);
  }

  async startRestore(request: RestoreRequest): Promise<{ jobId: string; dryRunResult?: DryRunResult }> {
    const response = await this.api.post('restores', { data: { isDryRun: false, ...request } });
    const started = await expectSuccessEnvelope<{ jobId: string; dryRunResult?: DryRunResult }>(
      response,
      202,
    );
    this.restoreIds.add(started.jobId);
    return started;
  }

  waitForRestore(jobId: string, options?: WaitOptions<RestoreJob>): Promise<RestoreJob> {
    return waitForJob<RestoreJob>(this.api, 'restores', jobId, options);
  }

  /** Starts a restore and waits until it is `completed`. */
  async restore(request: RestoreRequest): Promise<RestoreJob> {
    const { jobId } = await this.startRestore(request);
    return this.waitForRestore(jobId);
  }

  /**
   * Cancels the jobs that did not finish (a test that timed out leaves them
   * behind) and deletes the dumps and manifests the backups stored. Stopping a
   * job is best effort: it may finish between the check and the cancel.
   */
  async cleanUp(): Promise<void> {
    await Promise.all([
      ...[...this.backupIds].map((id) => this.cancelUnfinished('backups', id)),
      ...[...this.restoreIds].map((id) => this.cancelUnfinished('restores', id)),
    ]);
    await deleteObjects([...this.fileKeys].flatMap((key) => [key, manifestKey(key)]));
  }

  private async cancelUnfinished(kind: JobKind, id: string): Promise<void> {
    const response = await this.api.get(`${kind}/${id}`);
    if (!response.ok()) {
      return;
    }
    const { data } = (await response.json()) as { data: JobBase };
    if (data.status === 'pending' || data.status === 'running') {
      await this.api.post(`${kind}/${id}/cancel`);
    }
  }
}
