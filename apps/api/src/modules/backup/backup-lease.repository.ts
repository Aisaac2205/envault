import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

type LeaseRow = { connectionId: string };
type LeaseMutationResult = LeaseRow[] | [LeaseRow[], number];

@Injectable()
export class BackupLeaseRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async tryAcquire(
    connectionId: string,
    backupJobId: string,
    leaseToken: string,
    ttlMs: number,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `INSERT INTO backup_leases ("connectionId", "backupJobId", "leaseToken", "expiresAt", "acquiredAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, CURRENT_TIMESTAMP + $4 * interval '1 ms', CURRENT_TIMESTAMP)
       ON CONFLICT ("connectionId") DO UPDATE
       SET "backupJobId" = EXCLUDED."backupJobId",
           "leaseToken" = EXCLUDED."leaseToken",
           "expiresAt" = EXCLUDED."expiresAt",
           "acquiredAt" = EXCLUDED."acquiredAt"
       WHERE backup_leases."expiresAt" <= CURRENT_TIMESTAMP
       RETURNING "connectionId"`,
      [connectionId, backupJobId, leaseToken, ttlMs],
    );

    return this.hasAffectedRows(rows);
  }

  async renew(
    connectionId: string,
    backupJobId: string,
    leaseToken: string,
    ttlMs: number,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `UPDATE backup_leases
       SET "expiresAt" = CURRENT_TIMESTAMP + $4 * interval '1 ms'
       WHERE "connectionId" = $1::uuid
         AND "backupJobId" = $2::uuid
         AND "leaseToken" = $3::uuid
         AND "expiresAt" > CURRENT_TIMESTAMP
       RETURNING "connectionId"`,
      [connectionId, backupJobId, leaseToken, ttlMs],
    );

    return this.hasAffectedRows(rows);
  }

  async release(
    connectionId: string,
    backupJobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `DELETE FROM backup_leases
       WHERE "connectionId" = $1::uuid
         AND "backupJobId" = $2::uuid
         AND "leaseToken" = $3::uuid
       RETURNING "connectionId"`,
      [connectionId, backupJobId, leaseToken],
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
