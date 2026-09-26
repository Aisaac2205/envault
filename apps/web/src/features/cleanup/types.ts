import type { BackupCategory } from "@/types/backup.types";

export interface CleanupError {
  key: string;
  message: string;
}

export interface StorageConnectionUsage {
  connectionSlug: string;
  connectionName: string;
  count: number;
  sizeMb: number;
  oldest: string | null;
}

export interface StorageCategoryUsage {
  category: BackupCategory;
  count: number;
  sizeMb: number;
}

export interface StorageOverview {
  totalDumps: number;
  totalSizeMb: number;
  byConnection: StorageConnectionUsage[];
  byCategory: StorageCategoryUsage[];
}

export interface DbHygienePreview {
  failedCount: number;
}

export interface DbHygieneResult {
  deleted: number;
}

export interface StaleDbRow {
  id: string;
  fileKey: string;
}

export interface OrphanDump {
  key: string;
  hasManifest: boolean;
}

export interface ReconcilePreview {
  staleDbRows: StaleDbRow[];
  orphanManifests: string[];
  orphanDumps: OrphanDump[];
}

export interface ReconcileResult {
  dbRowsDeleted: number;
  manifestsDeleted: number;
  dumpsDeleted: number;
  untrackedKept: number;
  errors: CleanupError[];
}

// ─── Per-connection retention policy (new) ───────────────────────────────

export interface ConnectionRetentionPolicy {
  category: BackupCategory;
  retentionDays: number | null;
}

export interface ConnectionRetentionPolicyInput {
  category: BackupCategory;
  retentionDays: number | null;
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

export interface RetentionPreviewItem {
  category: BackupCategory;
  count: number;
  totalSizeMb: number;
  totalBytes?: number;
  protectedCount?: number;
  candidates?: DryRunCandidate[];
}

export interface RetentionRunItem {
  category: BackupCategory;
  deleted: number;
  freedMb: number;
  errors: number;
}
