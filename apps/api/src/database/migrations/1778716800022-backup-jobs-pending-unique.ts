import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforces exactly one PENDING backup job per (connectionId, category) via a
 * partial unique index. Existing duplicate PENDING rows would make the index
 * creation fail, so `up()` first dedupes them: the oldest PENDING row per
 * (connectionId, category) is kept, the rest are marked FAILED. Rows with a
 * NULL category are left alone — Postgres treats every NULL as distinct for
 * uniqueness purposes, so they can never violate the new index.
 */
export class BackupJobsPendingUnique1778716800022 implements MigrationInterface {
  name = 'BackupJobsPendingUnique1778716800022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY "connectionId", category
          ORDER BY "createdAt", id
        ) AS rn
        FROM backup_jobs
        WHERE status = 'pending' AND category IS NOT NULL
      )
      UPDATE backup_jobs b
      SET status = 'failed',
          "completedAt" = now(),
          "errorMessage" = 'Duplicate pending backup superseded by migration'
      FROM ranked r
      WHERE b.id = r.id AND r.rn > 1
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_backup_jobs_pending_connection_category"
      ON backup_jobs ("connectionId", category)
      WHERE status = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_backup_jobs_pending_connection_category"',
    );
  }
}
