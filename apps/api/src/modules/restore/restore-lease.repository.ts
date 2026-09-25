import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

type LeaseRow = { targetConnectionId: string };
type LeaseMutationResult = LeaseRow[] | [LeaseRow[], number];

@Injectable()
export class RestoreLeaseRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async tryAcquire(
    targetConnectionId: string,
    restoreJobId: string,
    leaseToken: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `INSERT INTO restore_leases ("targetConnectionId", "restoreJobId", "leaseToken", "expiresAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
       ON CONFLICT ("targetConnectionId") DO UPDATE
       SET "restoreJobId" = EXCLUDED."restoreJobId",
           "leaseToken" = EXCLUDED."leaseToken",
           "expiresAt" = EXCLUDED."expiresAt"
       WHERE restore_leases."expiresAt" <= CURRENT_TIMESTAMP
       RETURNING "targetConnectionId"`,
      [targetConnectionId, restoreJobId, leaseToken, expiresAt],
    );

    return this.hasAffectedRows(rows);
  }

  async renew(
    targetConnectionId: string,
    restoreJobId: string,
    leaseToken: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `UPDATE restore_leases
       SET "expiresAt" = $4
       WHERE "targetConnectionId" = $1::uuid
         AND "restoreJobId" = $2::uuid
         AND "leaseToken" = $3::uuid
         AND "expiresAt" > CURRENT_TIMESTAMP
       RETURNING "targetConnectionId"`,
      [targetConnectionId, restoreJobId, leaseToken, expiresAt],
    );

    return this.hasAffectedRows(rows);
  }

  async release(
    targetConnectionId: string,
    restoreJobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `DELETE FROM restore_leases
       WHERE "targetConnectionId" = $1::uuid
         AND "restoreJobId" = $2::uuid
         AND "leaseToken" = $3::uuid
       RETURNING "targetConnectionId"`,
      [targetConnectionId, restoreJobId, leaseToken],
    );

    return this.hasAffectedRows(rows);
  }

  async releaseByJobId(restoreJobId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `DELETE FROM restore_leases
       WHERE "restoreJobId" = $1::uuid
       RETURNING "targetConnectionId"`,
      [restoreJobId],
    );

    return this.hasAffectedRows(rows);
  }

  private hasAffectedRows(result: LeaseMutationResult): boolean {
    if (this.isMutationResult(result)) {
      return result[1] > 0;
    }

    return result.length > 0;
  }

  private isMutationResult(
    result: LeaseMutationResult,
  ): result is [LeaseRow[], number] {
    return Array.isArray(result[0]);
  }
}
