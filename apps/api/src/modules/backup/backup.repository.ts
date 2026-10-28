import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import {
  Between,
  DataSource,
  FindOptionsWhere,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  BackupJobEntity,
  StorageKeyVersion,
} from '../../database/entities/backup-job.entity';
import { JobStatus } from '../../database/enums/job-status.enum';
import { Environment } from '../../database/enums/environment.enum';
import { DbTypeEnum } from '../../database/enums/db-type.enum';
import { BackupCategory } from '../../database/enums/backup-category.enum';

type BackupJobMutationRow = { id: string };
type BackupJobMutationResult =
  | BackupJobMutationRow[]
  | [BackupJobMutationRow[], number];

export interface InsertPendingBackupJobInput {
  connectionId: string;
  environment: Environment;
  dbType: DbTypeEnum;
  fileKey: string;
  triggeredBy: string;
  category: BackupCategory;
  storageKeyVersion: StorageKeyVersion;
}

const MAX_COALESCE_ATTEMPTS = 3;

@Injectable()
export class BackupRepository {
  constructor(
    @InjectRepository(BackupJobEntity)
    private readonly repository: Repository<BackupJobEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * When pagination options are provided, uses findAndCount with skip/take.
   * When omitted, returns all rows (backward compatibility for non-list endpoints).
   */
  async findAll(options?: {
    page?: number;
    pageSize?: number;
    connectionId?: string;
    environment?: Environment;
    status?: JobStatus;
    from?: string;
    to?: string;
  }): Promise<{ data: BackupJobEntity[]; total: number }> {
    const where: FindOptionsWhere<BackupJobEntity> = {};
    if (options?.connectionId) {
      where.connectionId = options.connectionId;
    }
    if (options?.environment) {
      where.environment = options.environment;
    }
    if (options?.status) {
      where.status = options.status;
    }
    if (options?.from || options?.to) {
      if (options.from && options.to) {
        where.createdAt = Between(new Date(options.from), new Date(options.to));
      } else if (options.from) {
        where.createdAt = MoreThanOrEqual(new Date(options.from));
      } else if (options.to) {
        where.createdAt = LessThanOrEqual(new Date(options.to));
      }
    }

    if (options?.page && options?.pageSize) {
      const [data, total] = await this.repository.findAndCount({
        where,
        order: { createdAt: 'DESC' },
        take: options.pageSize,
        skip: (options.page - 1) * options.pageSize,
      });
      return { data, total };
    }
    const data = await this.repository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return { data, total: data.length };
  }

  findById(id: string): Promise<BackupJobEntity | null> {
    // TypeORM drops a where condition whose value is undefined, so an empty id
    // would become a query without a where clause and return an arbitrary row.
    if (!id) return Promise.resolve(null);
    return this.repository.findOne({ where: { id } });
  }

  findByConnection(connectionId: string): Promise<BackupJobEntity[]> {
    return this.repository.find({
      where: { connectionId },
      order: { createdAt: 'DESC' },
    });
  }

  findAllUnfinished(): Promise<BackupJobEntity[]> {
    return this.repository.find({
      where: {
        status: In([JobStatus.PENDING, JobStatus.RUNNING]),
      },
      order: { createdAt: 'ASC' },
    });
  }

  create(data: Partial<BackupJobEntity>): Promise<BackupJobEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  /**
   * Atomically enqueues a PENDING backup, or returns the existing PENDING
   * ticket for the same (connectionId, category) instead of creating a
   * duplicate. Relies on the partial unique index created by migration
   * 1778716800022 as the `ON CONFLICT` target: `INSERT ... DO NOTHING`
   * avoids the TOCTOU window a check-then-insert would have. If the insert
   * loses the race, the follow-up SELECT can itself race with the winner's
   * own completion (PENDING -> RUNNING/COMPLETED) before it runs, so the
   * loop retries the insert up to `MAX_COALESCE_ATTEMPTS` times.
   */
  async insertPendingOrFindExisting(
    data: InsertPendingBackupJobInput,
  ): Promise<{ job: BackupJobEntity; created: boolean }> {
    for (let attempt = 0; attempt < MAX_COALESCE_ATTEMPTS; attempt++) {
      const inserted = await this.dataSource.query<BackupJobEntity[]>(
        `INSERT INTO backup_jobs
           (id, "connectionId", environment, "dbType", status, "fileKey", "storageKeyVersion", category, "triggeredBy")
         VALUES ($1::uuid, $2::uuid, $3, $4, 'pending', $5, $6, $7, $8)
         ON CONFLICT ("connectionId", category) WHERE status = 'pending' DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          data.connectionId,
          data.environment,
          data.dbType,
          data.fileKey,
          data.storageKeyVersion,
          data.category,
          data.triggeredBy,
        ],
      );

      if (inserted.length > 0) {
        return { job: this.repository.create(inserted[0]), created: true };
      }

      const existing = await this.repository.findOne({
        where: {
          connectionId: data.connectionId,
          category: data.category,
          status: JobStatus.PENDING,
        },
        order: { createdAt: 'ASC' },
      });
      if (existing) {
        return { job: existing, created: false };
      }
    }

    throw new Error(
      `Failed to enqueue backup for connection ${data.connectionId}/${data.category} after ${MAX_COALESCE_ATTEMPTS} coalescing attempts`,
    );
  }

  async updateStatus(
    id: string,
    status: JobStatus,
    updates?: Partial<BackupJobEntity>,
  ): Promise<void> {
    await this.repository.update(id, { status, ...updates });
  }

  /** Finds job rows whose fileKey is in the given list. */
  findByFileKeys(fileKeys: string[]): Promise<BackupJobEntity[]> {
    if (fileKeys.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { fileKey: In(fileKeys) } });
  }

  /**
   * Deletes job rows whose fileKey is in the given list and rolls them up into
   * `backup_daily_rollups` in the same statement. Returns rows removed.
   */
  deleteByFileKeys(fileKeys: string[]): Promise<number> {
    if (fileKeys.length === 0) return Promise.resolve(0);
    return this.deleteAndRollUp(`"fileKey" = ANY($1::varchar[])`, [fileKeys]);
  }

  /**
   * Deletes job rows by id and rolls them up into `backup_daily_rollups` in the
   * same statement. Returns rows removed.
   */
  deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);
    return this.deleteAndRollUp(`id = ANY($1::uuid[])`, [ids]);
  }

  /** Count of FAILED jobs created before the cutoff (DB-hygiene preview). */
  countFailedOlderThan(cutoff: Date): Promise<number> {
    return this.repository.count({
      where: { status: JobStatus.FAILED, createdAt: LessThan(cutoff) },
    });
  }

  /**
   * Removes FAILED jobs created before the cutoff and rolls them up into
   * `backup_daily_rollups` in the same statement. Returns rows removed.
   */
  deleteFailedOlderThan(cutoff: Date): Promise<number> {
    return this.deleteAndRollUp(`status = $1 AND "createdAt" < $2`, [
      JobStatus.FAILED,
      cutoff,
    ]);
  }

  /**
   * Single funnel for every `backup_jobs` delete. One statement deletes the
   * rows, aggregates the COMPLETED and FAILED ones per (connectionId, UTC day)
   * and adds them to `backup_daily_rollups`, so the daily analytics keep their
   * history after a purge and the delete and the rollup commit together.
   *
   * `DELETE ... RETURNING` yields each row to exactly one statement, so even
   * concurrent unlocked purges roll a row up exactly once. PENDING and RUNNING
   * rows are deleted but never aggregated. The upsert inserts in key order so
   * two concurrent purges lock the shared rollup rows in the same order.
   *
   * `where` is a constant predicate written by the caller (never user input),
   * numbered from `$1` over `params`; the two status parameters follow.
   */
  private async deleteAndRollUp(where: string, params: unknown[]): Promise<number> {
    const completed = `$${params.length + 1}`;
    const failed = `$${params.length + 2}`;
    const rows = await this.dataSource.query<{ deleted: number }[]>(
      `WITH deleted AS (
         DELETE FROM backup_jobs
         WHERE ${where}
         RETURNING "connectionId", "createdAt", status, "startedAt", "completedAt", "fileSizeMb"
       ),
       agg AS (
         SELECT d."connectionId" AS "connectionId",
                DATE(d."createdAt") AS "day",
                (COUNT(*) FILTER (WHERE d.status = ${completed}))::int AS completed,
                (COUNT(*) FILTER (WHERE d.status = ${failed}))::int AS failed,
                COALESCE(SUM(d."fileSizeMb") FILTER (WHERE d.status = ${completed}), 0)::float8 AS "totalSizeMb",
                COALESCE(
                  array_agg(EXTRACT(EPOCH FROM (d."completedAt" - d."startedAt"))::float8)
                    FILTER (WHERE d.status = ${completed}
                              AND d."startedAt" IS NOT NULL
                              AND d."completedAt" IS NOT NULL),
                  '{}'::float8[]
                ) AS "durationsSeconds"
         FROM deleted d
         WHERE d.status IN (${completed}, ${failed})
         GROUP BY d."connectionId", DATE(d."createdAt")
       ),
       rolled AS (
         INSERT INTO backup_daily_rollups AS r
           ("connectionId", "day", completed, failed, "totalSizeMb", "durationsSeconds")
         SELECT "connectionId", "day", completed, failed, "totalSizeMb", "durationsSeconds"
         FROM agg
         ORDER BY "connectionId", "day"
         ON CONFLICT ("connectionId", "day") DO UPDATE SET
           completed = r.completed + EXCLUDED.completed,
           failed = r.failed + EXCLUDED.failed,
           "totalSizeMb" = r."totalSizeMb" + EXCLUDED."totalSizeMb",
           "durationsSeconds" = r."durationsSeconds" || EXCLUDED."durationsSeconds",
           "updatedAt" = now()
       )
       SELECT COUNT(*)::int AS deleted FROM deleted`,
      [...params, JobStatus.COMPLETED, JobStatus.FAILED],
    );
    return Number(rows[0]?.deleted ?? 0);
  }

  /**
   * Conditionally flips a job to RUNNING. Allows PENDING/RUNNING always, and
   * FAILED only when `isRetry` is true (our own `attempts: 2` retry), so a
   * concurrent cancel or sweep cannot be resurrected by a stale decision.
   */
  async startIfRunnable(
    id: string,
    startedAt: Date,
    isRetry: boolean,
  ): Promise<boolean> {
    const statuses = isRetry
      ? [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED]
      : [JobStatus.PENDING, JobStatus.RUNNING];

    const result = await this.dataSource.query<BackupJobMutationResult>(
      `UPDATE backup_jobs
       SET status = $2, "startedAt" = $3
       WHERE id = $1::uuid
         AND status = ANY($4::backup_jobs_status_enum[])
       RETURNING id`,
      [id, JobStatus.RUNNING, startedAt, statuses],
    );

    return this.hasAffectedRows(result);
  }

  /**
   * Fails a job only if it is still PENDING or RUNNING, so this write can
   * never overwrite an outcome already recorded by a concurrent cancel or
   * sweep.
   */
  async markFailedIfUnfinished(
    id: string,
    errorMessage: string,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<BackupJobMutationResult>(
      `UPDATE backup_jobs
       SET status = $2, "errorMessage" = $3, "completedAt" = $4
       WHERE id = $1::uuid
         AND status = ANY($5::backup_jobs_status_enum[])
       RETURNING id`,
      [
        id,
        JobStatus.FAILED,
        errorMessage,
        completedAt,
        [JobStatus.PENDING, JobStatus.RUNNING],
      ],
    );

    return this.hasAffectedRows(result);
  }

  /**
   * Fails a PENDING row on boot only if it is older than the 60s grace
   * period, so an in-flight `createBackup` insert is never swept before its
   * BullMQ job is enqueued.
   */
  async failPendingStale(
    id: string,
    errorMessage: string,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<BackupJobMutationResult>(
      `UPDATE backup_jobs
       SET status = $2, "errorMessage" = $3, "completedAt" = $4
       WHERE id = $1::uuid
         AND status = $5
         AND "createdAt" < now() - interval '60 seconds'
       RETURNING id`,
      [id, JobStatus.FAILED, errorMessage, completedAt, JobStatus.PENDING],
    );

    return this.hasAffectedRows(result);
  }

  /**
   * Fails a job only if it is still PENDING/RUNNING AND the given lease
   * token still owns the connection's lease row. Ownership (not expiry) is
   * the fence: if a different replica has already taken over the lease for
   * this connection+job, this write affects zero rows so the fenced-out
   * caller never overwrites the new owner's outcome.
   */
  async failIfLeaseHeld(
    id: string,
    connectionId: string,
    leaseToken: string,
    errorMessage: string,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<BackupJobMutationResult>(
      `UPDATE backup_jobs
       SET status = $2, "errorMessage" = $3, "completedAt" = $4
       WHERE id = $1::uuid
         AND status = ANY($5::backup_jobs_status_enum[])
         AND EXISTS (
           SELECT 1 FROM backup_leases l
           WHERE l."connectionId" = $6::uuid
             AND l."backupJobId" = $1::uuid
             AND l."leaseToken" = $7::uuid
         )
       RETURNING id`,
      [
        id,
        JobStatus.FAILED,
        errorMessage,
        completedAt,
        [JobStatus.PENDING, JobStatus.RUNNING],
        connectionId,
        leaseToken,
      ],
    );

    return this.hasAffectedRows(result);
  }

  /**
   * Completes a job only if it is still PENDING/RUNNING AND the given lease
   * token still owns the connection's lease row. Same fencing rationale as
   * `failIfLeaseHeld`, applied to the success path.
   */
  async completeIfLeaseHeld(
    id: string,
    connectionId: string,
    leaseToken: string,
    data: { fileSizeMb: number; sha256: string; bytes: number; completedAt: Date },
  ): Promise<boolean> {
    const result = await this.dataSource.query<BackupJobMutationResult>(
      `UPDATE backup_jobs
       SET status = $2, "fileSizeMb" = $3, "sha256" = $4, "bytes" = $5, "completedAt" = $6
       WHERE id = $1::uuid
         AND status = ANY($7::backup_jobs_status_enum[])
         AND EXISTS (
           SELECT 1 FROM backup_leases l
           WHERE l."connectionId" = $8::uuid
             AND l."backupJobId" = $1::uuid
             AND l."leaseToken" = $9::uuid
         )
       RETURNING id`,
      [
        id,
        JobStatus.COMPLETED,
        data.fileSizeMb,
        data.sha256,
        data.bytes,
        data.completedAt,
        [JobStatus.PENDING, JobStatus.RUNNING],
        connectionId,
        leaseToken,
      ],
    );

    return this.hasAffectedRows(result);
  }

  /**
   * Fails a RUNNING row on boot only if no live lease still holds it, so a
   * job still owned by another replica is never swept.
   */
  async failRunningWithoutLease(
    id: string,
    errorMessage: string,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<BackupJobMutationResult>(
      `UPDATE backup_jobs
       SET status = $2, "errorMessage" = $3, "completedAt" = $4
       WHERE id = $1::uuid
         AND status = $5
         AND NOT EXISTS (
           SELECT 1 FROM backup_leases
           WHERE "backupJobId" = $1::uuid
             AND "expiresAt" > CURRENT_TIMESTAMP
         )
       RETURNING id`,
      [id, JobStatus.FAILED, errorMessage, completedAt, JobStatus.RUNNING],
    );

    return this.hasAffectedRows(result);
  }

  private hasAffectedRows(result: BackupJobMutationResult): boolean {
    if (this.isMutationResult(result)) {
      return result[1] > 0;
    }

    return result.length > 0;
  }

  private isMutationResult(
    result: BackupJobMutationResult,
  ): result is [BackupJobMutationRow[], number] {
    return Array.isArray(result[0]);
  }
}
