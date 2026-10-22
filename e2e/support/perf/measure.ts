import type { BackupJob, RestoreJob } from '../jobs';
import { mean, throughputMiBps } from './stats';

/**
 * From job rows to the numbers the report is made of. Durations always come
 * from the timestamps the API stores with the job (millisecond precision, set
 * by the worker), never from how often a test polled: polling only decides how
 * soon the test notices that a job is done.
 *
 * Metric names end with their unit: `Ms`, `Bytes`, `MiBps` (MiB per second).
 */

/** Timestamps of a finished backup, in epoch milliseconds. */
export interface BackupTimings {
  jobId: string;
  createdAt: number;
  startedAt: number;
  completedAt: number;
  /** `startedAt - createdAt`: how long the job waited in the queue for a worker. */
  queueWaitMs: number;
  /** `completedAt - startedAt`: the dump and the upload. */
  durationMs: number;
}

/**
 * Timestamps of a finished restore. The row is stamped `startedAt` when the API
 * admits the request, but the worker overwrites it with the real start when it
 * takes the job, so on a finished restore `startedAt - createdAt` is the queue
 * wait, as for a backup (a dry run is the exception and is not measured here).
 */
export interface RestoreTimings {
  jobId: string;
  createdAt: number;
  startedAt: number;
  completedAt: number;
  queueWaitMs: number;
  durationMs: number;
}

function epoch(value: string | null, field: string, jobId: string): number {
  const time = Date.parse(value ?? '');
  if (Number.isNaN(time)) {
    throw new Error(`Job ${jobId} has no usable ${field} (${String(value)}): it cannot be timed.`);
  }
  return time;
}

export function backupTimings(job: Pick<BackupJob, 'id' | 'createdAt' | 'startedAt' | 'completedAt'>): BackupTimings {
  const createdAt = epoch(job.createdAt, 'createdAt', job.id);
  const startedAt = epoch(job.startedAt, 'startedAt', job.id);
  const completedAt = epoch(job.completedAt, 'completedAt', job.id);
  if (!(createdAt <= startedAt && startedAt <= completedAt)) {
    throw new Error(
      `Backup job ${job.id} has timestamps out of order (created ${job.createdAt}, started ${job.startedAt}, completed ${job.completedAt}).`,
    );
  }
  return {
    jobId: job.id,
    createdAt,
    startedAt,
    completedAt,
    queueWaitMs: startedAt - createdAt,
    durationMs: completedAt - startedAt,
  };
}

export function restoreTimings(
  job: Pick<RestoreJob, 'id' | 'createdAt' | 'startedAt' | 'completedAt'>,
): RestoreTimings {
  const createdAt = epoch(job.createdAt, 'createdAt', job.id);
  const startedAt = epoch(job.startedAt, 'startedAt', job.id);
  const completedAt = epoch(job.completedAt, 'completedAt', job.id);
  if (!(createdAt <= startedAt && startedAt <= completedAt)) {
    throw new Error(
      `Restore job ${job.id} has timestamps out of order (created ${job.createdAt}, started ${job.startedAt}, completed ${job.completedAt}).`,
    );
  }
  return {
    jobId: job.id,
    createdAt,
    startedAt,
    completedAt,
    queueWaitMs: startedAt - createdAt,
    durationMs: completedAt - startedAt,
  };
}

export interface ThroughputInput {
  /** Tables plus indexes of the source, as the database reports them. */
  sourceBytes: number;
  /** Size of the dump, from the backup job. */
  dumpBytes: number;
  backup: BackupTimings;
  /** From the test's request to the moment it saw the job completed. */
  backupWallMs: number;
  restore: RestoreTimings;
  restoreWallMs: number;
}

/** The numbers of one repetition of a dump-and-restore case. */
export function throughputMetrics(input: ThroughputInput): Record<string, number> {
  const { sourceBytes, dumpBytes, backup, restore } = input;
  return {
    'backup.queueWaitMs': backup.queueWaitMs,
    'backup.durationMs': backup.durationMs,
    'backup.wallMs': input.backupWallMs,
    'backup.dumpBytes': dumpBytes,
    'backup.sourceMiBps': throughputMiBps(sourceBytes, backup.durationMs),
    'backup.dumpMiBps': throughputMiBps(dumpBytes, backup.durationMs),
    'restore.queueWaitMs': restore.queueWaitMs,
    'restore.durationMs': restore.durationMs,
    'restore.wallMs': input.restoreWallMs,
    'restore.sourceMiBps': throughputMiBps(sourceBytes, restore.durationMs),
    'restore.dumpMiBps': throughputMiBps(dumpBytes, restore.durationMs),
  };
}

/**
 * The numbers of K backups launched together. The jobs are ranked by the moment
 * a worker took them (`startedAt`), so `rank3.queueWaitMs` is the wait of the
 * third job to start: with two workers it is about one backup long, the step of
 * the staircase.
 */
export function queueBackupMetrics(jobs: readonly BackupTimings[]): Record<string, number> {
  const ranked = [...jobs].sort((a, b) => a.startedAt - b.startedAt || a.createdAt - b.createdAt);
  const makespanMs = Math.max(...jobs.map((job) => job.completedAt)) - Math.min(...jobs.map((job) => job.createdAt));
  const queueWaits = jobs.map((job) => job.queueWaitMs);
  const durations = jobs.map((job) => job.durationMs);

  const metrics: Record<string, number> = {
    makespanMs,
    queueWaitMeanMs: mean(queueWaits),
    queueWaitMaxMs: Math.max(...queueWaits),
    durationMeanMs: mean(durations),
    durationMaxMs: Math.max(...durations),
    // Total backup time divided by elapsed time: how many backups ran at once on average.
    parallelism: durations.reduce((sum, value) => sum + value, 0) / Math.max(makespanMs, 1),
  };
  ranked.forEach((job, index) => {
    metrics[`rank${index + 1}.queueWaitMs`] = job.queueWaitMs;
    metrics[`rank${index + 1}.durationMs`] = job.durationMs;
  });
  return metrics;
}

/**
 * The numbers of R restores launched together, ranked by completion. With one
 * restore worker each job starts when the previous one ends: the later jobs
 * show a queue wait of about one restore, and `completionGapMs` (the mean gap
 * between consecutive completions) is about one restore duration.
 */
export function queueRestoreMetrics(jobs: readonly RestoreTimings[]): Record<string, number> {
  const ranked = [...jobs].sort((a, b) => a.completedAt - b.completedAt);
  const queueWaits = jobs.map((job) => job.queueWaitMs);
  const metrics: Record<string, number> = {
    makespanMs: Math.max(...jobs.map((job) => job.completedAt)) - Math.min(...jobs.map((job) => job.createdAt)),
    queueWaitMaxMs: Math.max(...queueWaits),
  };
  if (ranked.length > 1) {
    // The mean gap between consecutive completions; with two jobs, simply the gap.
    metrics.completionGapMs = (ranked[ranked.length - 1].completedAt - ranked[0].completedAt) / (ranked.length - 1);
  }
  ranked.forEach((job, index) => {
    metrics[`done${index + 1}.queueWaitMs`] = job.queueWaitMs;
    metrics[`done${index + 1}.durationMs`] = job.durationMs;
  });
  return metrics;
}
