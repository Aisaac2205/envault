import { JobStatus } from '../../../database/enums/job-status.enum';

export interface BackupAnalyticsRange {
  /** First UTC day of the range, `YYYY-MM-DD`. */
  from: string;
  /** The UTC day after the last one, `YYYY-MM-DD`. */
  toExclusive: string;
  /** Restricts the rows to one connection; null or omitted covers every connection. */
  connectionId?: string | null;
}

export interface BackupAnalyticsSource {
  /** A `SELECT` to use as a derived table, exposing `connectionId`, `day`, `completed`, `failed`, `sizeMb` and `duration`. */
  sql: string;
  /** The values of the positional parameters the SQL text refers to ($1..$5). */
  params: unknown[];
}

/**
 * The one set of rows every backup analytics query aggregates: the live
 * `backup_jobs` rows plus the rollup of the rows retention, reconcile or DB
 * hygiene already deleted. The daily series and the connections health both
 * build on it, so a total can never differ between them. Three sources share
 * one range and one optional connection filter, merged with `UNION ALL`:
 * - live jobs, projected to one counter / size / duration per row;
 * - rollup rows, contributing completed, failed and size with no duration;
 * - the purged durations (`unnest`), contributing only a duration.
 *
 * A duration exists only for a completed job with both timestamps, and a
 * NULL is ignored by `percentile_cont` and `MAX`, so a purge changes nothing
 * in the result. Parameters: $1 from, $2 toExclusive, $3 completed status,
 * $4 failed status and, with a connection filter, $5 the connection.
 */
export function buildBackupAnalyticsSource({
  from,
  toExclusive,
  connectionId,
}: BackupAnalyticsRange): BackupAnalyticsSource {
  const params: unknown[] = [from, toExclusive, JobStatus.COMPLETED, JobStatus.FAILED];
  if (connectionId) params.push(connectionId);
  const liveFilter = connectionId ? ' AND j."connectionId" = $5' : '';
  const rollupFilter = connectionId ? ' AND r."connectionId" = $5' : '';
  const rollupRange = `r."day" >= CAST($1 AS date) AND r."day" < CAST($2 AS date)${rollupFilter}`;

  const sql = `SELECT j."connectionId" AS "connectionId",
                DATE(j."createdAt") AS "day",
                (j.status = $3)::int AS "completed",
                (j.status = $4)::int AS "failed",
                (CASE WHEN j.status = $3 THEN COALESCE(j."fileSizeMb", 0) ELSE 0 END)::float8 AS "sizeMb",
                (CASE WHEN j.status = $3 AND j."startedAt" IS NOT NULL AND j."completedAt" IS NOT NULL
                      THEN EXTRACT(EPOCH FROM (j."completedAt" - j."startedAt")) END)::float8 AS "duration"
         FROM backup_jobs j
         WHERE j."createdAt" >= CAST($1 AS date) AND j."createdAt" < CAST($2 AS date)${liveFilter}
         UNION ALL
         SELECT r."connectionId", r."day", r."completed", r."failed", r."totalSizeMb", NULL::float8
         FROM backup_daily_rollups r
         WHERE ${rollupRange}
         UNION ALL
         SELECT r."connectionId", r."day", 0, 0, 0::float8, d."duration"
         FROM backup_daily_rollups r
         CROSS JOIN LATERAL unnest(r."durationsSeconds") AS d("duration")
         WHERE ${rollupRange}`;

  return { sql, params };
}

/**
 * The aggregates the daily series and the connections health have in common,
 * over a derived table aliased `u` built from `buildBackupAnalyticsSource`.
 * Median and 95th percentile are exact (`percentile_cont` over every duration).
 */
export const BACKUP_COUNT_AND_PERCENTILE_AGGREGATES = `COALESCE(SUM(u."completed"), 0)::bigint AS "completed",
              COALESCE(SUM(u."failed"), 0)::bigint AS "failed",
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY u."duration")
                 FILTER (WHERE u."duration" IS NOT NULL))::float8 AS "p50",
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY u."duration")
                 FILTER (WHERE u."duration" IS NOT NULL))::float8 AS "p95"`;
