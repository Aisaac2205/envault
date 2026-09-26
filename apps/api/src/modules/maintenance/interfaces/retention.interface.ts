import type { BackupCategory } from '../../../database/enums/backup-category.enum';
import { EnrichedR2Object } from '../../backup/interfaces/enriched-r2-object.interface';

/**
 * Retention policy shared by ad-hoc cleanup, cronjob retention and the manual
 * sweeper. All fields optional; the engine requires at least one to be set.
 *
 * Combination (protective): the newest `max(keepLast, 1)` dumps are NEVER
 * deleted. Beyond that floor a dump is pruned if it matches ANY active trigger
 * (older than `maxAgeDays`, or cumulative size past `maxTotalSizeMb`). When only
 * `keepLast` is set, everything beyond the floor is pruned.
 */
export interface RetentionPolicy {
  keepLast?: number;
  maxAgeDays?: number;
  maxTotalSizeMb?: number;
}

export interface DryRunCandidate {
  fileKey: string;
  sizeBytes: number;
  lastModified: string;
  category: BackupCategory;
  reason: string;
  jobId: string | null;
  isProtected: boolean;
}

export interface CleanupPreview {
  items: EnrichedR2Object[];
  count: number;
  totalSizeMb: number;
  totalBytes: number;
  protectedCount: number;
  candidates: DryRunCandidate[];
}

export interface CleanupError {
  key: string;
  message: string;
}

export interface CleanupResult {
  deleted: number;
  freedMb: number;
  errors: CleanupError[];
}

/** Per-category retention policy row as stored and returned by the API. */
export interface ConnectionRetentionPolicy {
  category: BackupCategory;
  retentionDays: number | null;
}

/** Input for upserting a per-connection retention policy. */
export interface ConnectionRetentionPolicyInput {
  category: BackupCategory;
  retentionDays: number | null;
}

/** Preview of what would be pruned for one category under a connection policy. */
export interface RetentionPreviewItem {
  category: BackupCategory;
  count: number;
  totalSizeMb: number;
  totalBytes: number;
  protectedCount: number;
  candidates: DryRunCandidate[];
}

/** Result of running retention for one category. */
export interface RetentionRunItem {
  category: BackupCategory;
  deleted: number;
  freedMb: number;
  errors: number;
}
