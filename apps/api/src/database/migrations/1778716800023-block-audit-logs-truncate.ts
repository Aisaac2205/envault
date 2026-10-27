import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The trigger from 1778716800008 only covers row-level UPDATE and DELETE.
 * TRUNCATE never fires row-level triggers, so it emptied audit_logs without
 * an error. PostgreSQL only allows statement-level TRUNCATE triggers.
 */
export class BlockAuditLogsTruncate1778716800023 implements MigrationInterface {
  name = 'BlockAuditLogsTruncate1778716800023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TRIGGER audit_logs_no_truncate
      BEFORE TRUNCATE ON audit_logs
      FOR EACH STATEMENT
      EXECUTE FUNCTION prevent_audit_log_mutation();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs');
  }
}
