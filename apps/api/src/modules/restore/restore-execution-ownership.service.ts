import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { ConnectionEntity } from '../../database/entities/connection.entity';

export interface RestoreExecutionOwnership {
  queryRunner: QueryRunner;
  targetConnectionId: string;
}

@Injectable()
export class RestoreExecutionOwnershipService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async tryAcquire(
    targetConnectionId: string,
  ): Promise<RestoreExecutionOwnership | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    let acquired = false;

    try {
      await queryRunner.connect();
      const [result] = await queryRunner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [targetConnectionId],
      );

      if (result?.acquired !== true) {
        return null;
      }

      acquired = true;
      return { queryRunner, targetConnectionId };
    } finally {
      if (!acquired) {
        await queryRunner.release();
      }
    }
  }

  async release(ownership: RestoreExecutionOwnership): Promise<void> {
    try {
      await ownership.queryRunner.query(
        'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
        [ownership.targetConnectionId],
      );
    } finally {
      await ownership.queryRunner.release();
    }
  }

  async hasActiveLease(
    ownership: RestoreExecutionOwnership,
    restoreJobId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const rows = await ownership.queryRunner.query(
      `SELECT "targetConnectionId"
       FROM restore_leases
       WHERE "targetConnectionId" = $1::uuid
         AND "restoreJobId" = $2::uuid
         AND "leaseToken" = $3::uuid
         AND "expiresAt" > CURRENT_TIMESTAMP`,
      [ownership.targetConnectionId, restoreJobId, leaseToken],
    );

    return rows.length > 0;
  }

  findActiveTarget(
    ownership: RestoreExecutionOwnership,
  ): Promise<ConnectionEntity | null> {
    return ownership.queryRunner.manager.getRepository(ConnectionEntity).findOne({
      where: { id: ownership.targetConnectionId, isActive: true },
    });
  }
}
