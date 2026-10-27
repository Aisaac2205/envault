import { MigrationInterface } from 'typeorm';

type MigrationQueryRunner = {
  hasColumn(table: string, column: string): Promise<boolean>;
  query(query: string): Promise<unknown>;
};

export class RelaxBetterAuthIssuer1778716800024 implements MigrationInterface {
  name = 'RelaxBetterAuthIssuer1778716800024';

  public async up(queryRunner: MigrationQueryRunner): Promise<void> {
    // Better Auth 1.7.3+ no longer writes "account"."issuer", and its schema
    // diff (1.7.10+) refuses to boot when a column it never writes is NOT NULL
    // without a database default. Production got that shape from migration
    // 1778716800017 (NOT NULL, no default); fresh installs got NOT NULL with a
    // default from InitialSchema. Dropping NOT NULL satisfies the check on both.
    //
    // Idempotent and safe on every database shape: hasColumn is false when the
    // column or even the table is missing, and DROP NOT NULL on an already
    // nullable column is a no-op in Postgres. The column and its default are
    // intentionally left in place.
    if (await queryRunner.hasColumn('account', 'issuer')) {
      await queryRunner.query(
        'ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL',
      );
    }

    // The (issuer, accountId) identity index only existed to back the Better
    // Auth 1.7.0-1.7.2 contract. The name is mixed-case, so it must be quoted.
    await queryRunner.query(
      'DROP INDEX IF EXISTS "account_issuer_accountId_uidx"',
    );
  }

  public async down(_queryRunner: MigrationQueryRunner): Promise<void> {
    throw new Error(
      'Better Auth issuer relaxation cannot be reverted safely: rows written without an issuer would violate the old NOT NULL contract',
    );
  }
}
