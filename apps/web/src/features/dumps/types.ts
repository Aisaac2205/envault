import type { Connection } from "../connections/types";
import type { BackupCategory } from "@/types/backup.types";

export type { Connection };

export interface R2Object {
  key: string;
  size: number; // bytes
  uploaded: string; // ISO date
  etag?: string;
  httpEtag?: string;
}

export interface EnrichedR2Object {
  key: string;
  size: number;
  lastModified: string; // ISO date
  etag: string;
  connectionId: string;
  connectionSlug: string;
  connectionName: string;
  dbType: 'postgres' | 'mysql' | null;
  category: BackupCategory;
  timestamp: string;
}

export interface DumpsResponse {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface BackupJob {
  id: string;
  connectionId: string;
  /** Null when the connection was deleted after the backup ran. */
  connectionName: string | null;
  environment: string;
  dbType: "postgres" | "mysql" | null;
  status: JobStatus;
  fileKey: string | null;
  fileSizeMb: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  triggeredBy: string;
  createdAt: string;
}

export interface DumpsFilters {
  connectionId?: string;
  environment?: string;
  status?: JobStatus;
  from?: string;
  to?: string;
}

/** Server-paginated response shape matching PR #4 */
export interface PaginatedDumps {
  data: BackupJob[];
  total: number;
  page: number;
  pageSize: number;
}
