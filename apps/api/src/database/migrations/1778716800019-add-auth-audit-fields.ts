import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brings audit_logs up to the attributes OWASP requires per security event
 * (source address, outcome, severity) so Better Auth events can be recorded
 * in the same append-only trail as resource mutations.
 *
 * `environment` becomes nullable because its enum describes the environment
 * of an audited ERP connection (prod/dev/qa). A sign-in has no such
 * environment, and stamping one would poison the audit list filter.
 *
 * ALTER TABLE does not fire the audit_logs_immutable trigger — it is
 * declared BEFORE UPDATE OR DELETE FOR EACH ROW — so the append-only
 * guarantee is untouched by this migration.
 */
export class AddAuthAuditFields1778716800019 implements MigrationInterface {
  name = 'AddAuthAuditFields1778716800019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ipAddress" character varying',
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "userAgent" character varying',
    );
    // Existing rows are resource mutations that were only ever written on a
    // completed request, so 'success' is the accurate backfill for them.
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "outcome" character varying NOT NULL DEFAULT 'success'`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "severity" character varying NOT NULL DEFAULT 'low'`,
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ALTER COLUMN "environment" DROP NOT NULL',
    );
    // Failed sign-ins are queried by address and recency when investigating
    // credential stuffing; without this the lookup is a full scan.
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_audit_logs_outcome_created_at" ON "audit_logs" ("outcome", "createdAt")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "public"."IDX_audit_logs_outcome_created_at"',
    );
    await queryRunner.query(
      `UPDATE "audit_logs" SET "environment" = 'prod' WHERE "environment" IS NULL`,
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ALTER COLUMN "environment" SET NOT NULL',
    );
    await queryRunner.query('ALTER TABLE "audit_logs" DROP COLUMN "severity"');
    await queryRunner.query('ALTER TABLE "audit_logs" DROP COLUMN "outcome"');
    await queryRunner.query('ALTER TABLE "audit_logs" DROP COLUMN "userAgent"');
    await queryRunner.query('ALTER TABLE "audit_logs" DROP COLUMN "ipAddress"');
  }
}
