import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
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
import { BackupJobEntity } from '../../database/entities/backup-job.entity';
import { JobStatus } from '../../database/enums/job-status.enum';
import { Environment } from '../../database/enums/environment.enum';

type BackupJobMutationRow = { id: string };
type BackupJobMutationResult =
  | BackupJobMutationRow[]
  | [BackupJobMutationRow[], number];

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
    return this.repository.findOne({ where: { id } });
  }

  findByConnection(connectionId: string): Promise<BackupJobEntity[]> {
    return this.repository.find({
      where: { connectionId },
      order: { createdAt: 'DESC' },
    });
  }

  findActiveJobForConnection(connectionId: string): Promise<BackupJobEntity | null> {
    return this.repository.findOne({
      where: {
        connectionId,
        status: In([JobStatus.PENDING, JobStatus.RUNNING]),
      },
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

  /** Deletes job rows whose fileKey is in the given list. Returns rows removed. */
  async deleteByFileKeys(fileKeys: string[]): Promise<number> {
    if (fileKeys.length === 0) return 0;
    const result = await this.repository.delete({ fileKey: In(fileKeys) });
    return result.affected ?? 0;
  }

  /** Deletes job rows by id. Returns rows removed. */
  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.repository.delete({ id: In(ids) });
    return result.affected ?? 0;
  }

  /** Count of FAILED jobs created before the cutoff (DB-hygiene preview). */
  countFailedOlderThan(cutoff: Date): Promise<number> {
    return this.repository.count({
      where: { status: JobStatus.FAILED, createdAt: LessThan(cutoff) },
    });
  }

  /** Removes FAILED jobs created before the cutoff. Returns rows removed. */
  async deleteFailedOlderThan(cutoff: Date): Promise<number> {
    const result = await this.repository.delete({
      status: JobStatus.FAILED,
      createdAt: LessThan(cutoff),
    });
    return result.affected ?? 0;
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
         AND status = ANY($4::text[])
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
         AND status = ANY($5::text[])
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
