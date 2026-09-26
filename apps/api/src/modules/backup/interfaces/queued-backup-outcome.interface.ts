import { JobStatus } from '../../../database/enums/job-status.enum';
import { BackupResult } from './backup-result.interface';

/**
 * Outcome of `BackupService.executeQueuedBackup`. The processor decides what
 * to do with BullMQ (retry the wait, throw, etc.) based on this instead of
 * the service reaching into `Job`/`token` itself.
 */
export type QueuedBackupOutcome =
  | { kind: 'finished'; result: BackupResult }
  | { kind: 'deferred' }
  | { kind: 'skipped'; status: JobStatus };

/**
 * Typed reason carried by the single `AbortController` used per dump. Kept
 * as a closure-held union instead of `AbortSignal.any`/`AbortSignal.timeout`
 * because `signal.reason` is untyped (`any`) and `AbortSignal.timeout`
 * ignores jest fake timers.
 */
export type BackupAbortReason =
  | { kind: 'cancelled' }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'lease-lost'; cause: 'revoked' | 'renewal-deadline' };
