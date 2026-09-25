import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RestoreJobEntity } from '../../database/entities/restore-job.entity';
import { Environment } from '../../database/enums/environment.enum';
import { JobStatus } from '../../database/enums/job-status.enum';

interface RestoreQueueAdmission {
  id: string;
  sourceBackupId: string | null;
  r2Key: string | null;
  targetConnectionId: string;
  targetEnvironment: Environment;
  triggeredBy: string;
  startedAt: Date;
  leaseToken: string;
  expiresAt: Date;
}

type RestoreMutationRow = { id: string };
type RestoreMutationResult =
  | RestoreMutationRow[]
  | [RestoreMutationRow[], number];

@Injectable()
export class RestoreRepository {
  constructor(
    @InjectRepository(RestoreJobEntity)
    private readonly repository: Repository<RestoreJobEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  findAll(): Promise<RestoreJobEntity[]> {
    return this.repository.find({
      where: { isDryRun: false },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string): Promise<RestoreJobEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByTarget(targetConnectionId: string): Promise<RestoreJobEntity[]> {
    return this.repository.find({
      where: { targetConnectionId },
      order: { createdAt: 'DESC' },
    });
  }

  findByStatus(status: JobStatus): Promise<RestoreJobEntity[]> {
    return this.repository.find({ where: { status } });
  }

  create(data: Partial<RestoreJobEntity>): Promise<RestoreJobEntity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async tryCreateWithLease(data: RestoreQueueAdmission): Promise<string | null> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `WITH locked_target AS (
         SELECT id
         FROM connections
         WHERE id = $4::uuid
           AND "isActive" = TRUE
           AND environment <> $11
         FOR UPDATE
       ), lease AS (
         INSERT INTO restore_leases ("targetConnectionId", "restoreJobId", "leaseToken", "expiresAt")
         SELECT id, $1::uuid, $8::uuid, $9
         FROM locked_target
         ON CONFLICT ("targetConnectionId") DO UPDATE
         SET "restoreJobId" = EXCLUDED."restoreJobId",
             "leaseToken" = EXCLUDED."leaseToken",
             "expiresAt" = EXCLUDED."expiresAt"
         WHERE restore_leases."expiresAt" <= CURRENT_TIMESTAMP
         RETURNING "restoreJobId"
       )
       INSERT INTO restore_jobs (id, "sourceBackupId", "r2Key", "targetConnectionId", "targetEnvironment", status, "isDryRun", "startedAt", "triggeredBy")
       SELECT $1::uuid, $2, $3, $4, $5, $6, FALSE, $7, $10
       FROM lease
       RETURNING id`,
      [
        data.id,
        data.sourceBackupId,
        data.r2Key,
        data.targetConnectionId,
        data.targetEnvironment,
        JobStatus.PENDING,
        data.startedAt,
        data.leaseToken,
        data.expiresAt,
        data.triggeredBy,
        Environment.PROD,
      ],
    );

    return rows[0]?.id ?? null;
  }

  updateStatus(
    id: string,
    status: JobStatus,
    updates?: Partial<RestoreJobEntity>,
  ): Promise<RestoreJobEntity> {
    return this.repository.save({ id, status, ...updates });
  }

  async startIfLeaseActive(
    id: string,
    targetConnectionId: string,
    leaseToken: string,
    startedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<RestoreMutationResult>(
      `UPDATE restore_jobs
       SET status = $4, "startedAt" = $5
       WHERE id = $1::uuid
         AND "targetConnectionId" = $2
         AND status = $3
         AND EXISTS (
           SELECT 1
           FROM restore_leases
           WHERE "targetConnectionId" = $2::uuid
             AND "restoreJobId" = $1::uuid
             AND "leaseToken" = $6::uuid
             AND "expiresAt" > CURRENT_TIMESTAMP
         )
       RETURNING id`,
      [
        id,
        targetConnectionId,
        JobStatus.PENDING,
        JobStatus.RUNNING,
        startedAt,
        leaseToken,
      ],
    );

    return this.hasAffectedRows(result);
  }

  async recoverIfReclaimable(
    id: string,
    targetConnectionId: string,
    errorMessage: string,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<RestoreMutationResult>(
      `WITH recovered AS (
         UPDATE restore_jobs
         SET status = $5,
             "errorMessage" = $3,
             "completedAt" = $4
         WHERE id = $1::uuid
           AND "targetConnectionId" = $2
           AND status IN ($6, $7)
           AND NOT EXISTS (
             SELECT 1
             FROM restore_leases
             WHERE "targetConnectionId" = $2::uuid
               AND "expiresAt" > CURRENT_TIMESTAMP
           )
         RETURNING id
       ), released AS (
         DELETE FROM restore_leases
         USING recovered
         WHERE restore_leases."targetConnectionId" = $2::uuid
           AND restore_leases."restoreJobId" = recovered.id
           AND restore_leases."expiresAt" <= CURRENT_TIMESTAMP
       )
       SELECT id FROM recovered`,
      [
        id,
        targetConnectionId,
        errorMessage,
        completedAt,
        JobStatus.FAILED,
        JobStatus.PENDING,
        JobStatus.RUNNING,
      ],
    );

    return this.hasAffectedRows(result);
  }

  async failPendingIfLeaseInactive(
    id: string,
    targetConnectionId: string,
    leaseToken: string,
    errorMessage: string,
    completedAt: Date,
  ): Promise<boolean> {
    const result = await this.dataSource.query<RestoreMutationResult>(
      `UPDATE restore_jobs
       SET status = $4,
           "errorMessage" = $5,
           "completedAt" = $6
       WHERE id = $1::uuid
         AND "targetConnectionId" = $2
         AND status = $3
         AND NOT EXISTS (
           SELECT 1
           FROM restore_leases
           WHERE "targetConnectionId" = $2::uuid
             AND "restoreJobId" = $1::uuid
             AND "leaseToken" = $7::uuid
             AND "expiresAt" > CURRENT_TIMESTAMP
         )
       RETURNING id`,
      [
        id,
        targetConnectionId,
        JobStatus.PENDING,
        JobStatus.FAILED,
        errorMessage,
        completedAt,
        leaseToken,
      ],
    );

    return this.hasAffectedRows(result);
  }

  private hasAffectedRows(result: RestoreMutationResult): boolean {
    if (this.isMutationResult(result)) {
      return result[1] > 0;
    }

    return result.length > 0;
  }

  private isMutationResult(
    result: RestoreMutationResult,
  ): result is [RestoreMutationRow[], number] {
    return Array.isArray(result[0]);
  }
}
