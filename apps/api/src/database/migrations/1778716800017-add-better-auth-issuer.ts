import { MigrationInterface } from 'typeorm';

type MigrationQueryRunner = {
  query(query: string): Promise<void>;
};

export class AddBetterAuthIssuer1778716800017 implements MigrationInterface {
  name = 'AddBetterAuthIssuer1778716800017';

  public async up(queryRunner: MigrationQueryRunner): Promise<void> {
    // Idempotent: on a fresh install, InitialSchema already creates "account"
    // with "issuer" (NOT NULL, defaulted) and this unique index, so every
    // statement here is a no-op in that case. Only a pre-existing production
    // database (migrated incrementally before InitialSchema was updated to
    // include the folded-forward "issuer" column) needs these statements to
    // actually run.
    await queryRunner.query('ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text');
    await queryRunner.query(
      'UPDATE "account" SET "issuer" = \'local:credential\', "accountId" = "userId" WHERE "providerId" = \'credential\' AND "issuer" IS NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_uidx" ON "account" ("issuer", "accountId")',
    );
  }

  public async down(_queryRunner: MigrationQueryRunner): Promise<void> {
    throw new Error(
      'Cannot safely revert Better Auth issuer identity migration while Better Auth 1.7 is deployed',
    );
  }
}
