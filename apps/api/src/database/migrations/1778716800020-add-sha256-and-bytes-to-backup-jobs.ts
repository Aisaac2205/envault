import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSha256AndBytesToBackupJobs1778716800020
  implements MigrationInterface
{
  name = 'AddSha256AndBytesToBackupJobs1778716800020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "backup_jobs" ADD COLUMN IF NOT EXISTS "sha256" character varying(64)',
    );
    await queryRunner.query(
      'ALTER TABLE "backup_jobs" ADD COLUMN IF NOT EXISTS "bytes" bigint',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "backup_jobs" DROP COLUMN "bytes"');
    await queryRunner.query('ALTER TABLE "backup_jobs" DROP COLUMN "sha256"');
  }
}
