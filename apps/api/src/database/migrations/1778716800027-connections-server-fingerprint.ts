import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The server identity a connection really reaches. It is filled in when a PROD
 * connection is created, and the first time a restore needs it for the ones that
 * already exist: the migration cannot, it has no way to open their credentials.
 */
export class ConnectionsServerFingerprint1778716800027 implements MigrationInterface {
  name = 'ConnectionsServerFingerprint1778716800027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "serverFingerprint" character varying',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "connections" DROP COLUMN IF EXISTS "serverFingerprint"');
  }
}
