import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-day aggregates of `backup_jobs` rows that were deleted by retention,
 * reconcile or DB hygiene, so `/jobs/analytics/daily` keeps its history after
 * the purge. One row per (connectionId, day); `durationsSeconds` keeps the
 * duration of every purged completed row because percentiles cannot be
 * merged from pre-computed values.
 *
 * No foreign key on purpose: the rollup must outlive soft-deleted connections
 * and the job rows it summarizes (`backup_jobs.connectionId` has none either).
 */
export class CreateBackupDailyRollups1778716800025 implements MigrationInterface {
  name = 'CreateBackupDailyRollups1778716800025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "backup_daily_rollups" (
        "connectionId" character varying NOT NULL,
        "day" date NOT NULL,
        "completed" integer NOT NULL DEFAULT 0,
        "failed" integer NOT NULL DEFAULT 0,
        "totalSizeMb" double precision NOT NULL DEFAULT 0,
        "durationsSeconds" double precision array NOT NULL DEFAULT '{}',
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_backup_daily_rollups" PRIMARY KEY ("connectionId", "day")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "backup_daily_rollups"');
  }
}
