import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."restore_jobs_targetenvironment_enum" AS ENUM('prod', 'dev', 'sqa'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."restore_jobs_status_enum" AS ENUM('pending', 'running', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "restore_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sourceBackupId" character varying, "r2Key" character varying, "targetConnectionId" character varying NOT NULL, "targetEnvironment" "public"."restore_jobs_targetenvironment_enum" NOT NULL, "status" "public"."restore_jobs_status_enum" NOT NULL DEFAULT 'pending', "isDryRun" boolean NOT NULL DEFAULT false, "startedAt" TIMESTAMP NOT NULL, "completedAt" TIMESTAMP, "errorMessage" text, "triggeredBy" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c315e48b7f0d319fc3ca3c8336c" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."cronjobs_frequency_enum" AS ENUM('hourly', 'daily', 'weekly', 'custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."cronjobs_laststatus_enum" AS ENUM('pending', 'running', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cronjobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "connectionId" character varying NOT NULL, "cronExpression" character varying NOT NULL, "frequency" "public"."cronjobs_frequency_enum" NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "lastRunAt" TIMESTAMP, "nextRunAt" TIMESTAMP, "lastStatus" "public"."cronjobs_laststatus_enum", "retentionEnabled" boolean NOT NULL DEFAULT false, "retentionKeepLast" integer, "retentionMaxAgeDays" integer, "retentionMaxSizeMb" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b74e9d94eba10e8375cd33ed454" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."backup_jobs_environment_enum" AS ENUM('prod', 'dev', 'sqa'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."backup_jobs_dbtype_enum" AS ENUM('postgres', 'mysql'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."backup_jobs_status_enum" AS ENUM('pending', 'running', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."backup_jobs_category_enum" AS ENUM('manual', 'hourly', 'daily', 'weekly', 'custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "backup_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "connectionId" character varying NOT NULL, "environment" "public"."backup_jobs_environment_enum" NOT NULL, "dbType" "public"."backup_jobs_dbtype_enum", "status" "public"."backup_jobs_status_enum" NOT NULL DEFAULT 'pending', "fileKey" character varying, "storageKeyVersion" integer NOT NULL DEFAULT '1', "category" "public"."backup_jobs_category_enum", "fileSizeMb" double precision, "sha256" character varying(64), "bytes" bigint, "startedAt" TIMESTAMP, "completedAt" TIMESTAMP, "errorMessage" text, "triggeredBy" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d63aa10bc561df545b6532201c6" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."audit_logs_environment_enum" AS ENUM('prod', 'dev', 'sqa'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "action" character varying NOT NULL, "userId" character varying NOT NULL, "username" character varying NOT NULL, "resourceType" character varying NOT NULL, "resourceId" character varying NOT NULL, "metadata" jsonb, "environment" "public"."audit_logs_environment_enum", "ipAddress" character varying, "userAgent" character varying, "outcome" character varying NOT NULL DEFAULT 'success', "severity" character varying NOT NULL DEFAULT 'low', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_logs_outcome_created_at" ON "audit_logs" ("outcome", "createdAt")`,
    );

    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."connections_environment_enum" AS ENUM('prod', 'dev', 'sqa'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."connections_dbtype_enum" AS ENUM('postgres', 'mysql'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "slug" character varying(120) NOT NULL, "environment" "public"."connections_environment_enum" NOT NULL, "dbType" "public"."connections_dbtype_enum" NOT NULL DEFAULT 'postgres', "host" character varying NOT NULL, "port" integer NOT NULL, "database" character varying NOT NULL, "username" character varying NOT NULL, "password" character varying NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0a1f844af3122354cbd487a8d03" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_connections_slug_unique" ON "connections" ("slug")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "manual_retention_settings" ("id" integer NOT NULL DEFAULT 1, "enabled" boolean NOT NULL DEFAULT false, "keepLast" integer, "maxAgeDays" integer, "maxTotalSizeMb" integer, "lastSweepAt" TIMESTAMP, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_manual_retention_settings" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."connection_retention_policies_category_enum" AS ENUM('manual', 'hourly', 'daily', 'weekly', 'custom'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "connection_retention_policies" ("connectionId" uuid NOT NULL, "category" "public"."connection_retention_policies_category_enum" NOT NULL, "retentionDays" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_connection_retention_policies" PRIMARY KEY ("connectionId", "category"))`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "restore_leases" ("targetConnectionId" uuid NOT NULL, "restoreJobId" uuid NOT NULL, "leaseToken" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_restore_leases" PRIMARY KEY ("targetConnectionId"), CONSTRAINT "UQ_restore_leases_restoreJobId" UNIQUE ("restoreJobId"))`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" text NOT NULL PRIMARY KEY,
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "emailVerified" boolean NOT NULL DEFAULT false,
        "image" text,
        "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "role" text DEFAULT 'user',
        "banned" boolean DEFAULT false,
        "banReason" text,
        "banExpires" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "id" text NOT NULL PRIMARY KEY,
        "expiresAt" timestamptz NOT NULL,
        "token" text NOT NULL UNIQUE,
        "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "ipAddress" text,
        "userAgent" text,
        "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
        "impersonatedBy" text
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "account" (
        "id" text NOT NULL PRIMARY KEY,
        "accountId" text NOT NULL,
        "providerId" text NOT NULL,
        "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
        "accessToken" text,
        "refreshToken" text,
        "idToken" text,
        "accessTokenExpiresAt" timestamptz,
        "refreshTokenExpiresAt" timestamptz,
        "scope" text,
        "password" text,
        "issuer" text NOT NULL DEFAULT 'local:credential',
        "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "verification" (
        "id" text NOT NULL PRIMARY KEY,
        "identifier" text NOT NULL,
        "value" text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_uidx" ON "account" ("issuer", "accountId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "verification_identifier_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "verification"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "account_issuer_accountId_uidx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "account_userId_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "session_userId_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "session"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "restore_leases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "connection_retention_policies"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."connection_retention_policies_category_enum"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "manual_retention_settings"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_audit_logs_outcome_created_at"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_connections_slug_unique"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "connections"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."connections_dbtype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."connections_environment_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."audit_logs_environment_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "backup_jobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."backup_jobs_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."backup_jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."backup_jobs_dbtype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."backup_jobs_environment_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cronjobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."cronjobs_laststatus_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."cronjobs_frequency_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "restore_jobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."restore_jobs_status_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."restore_jobs_targetenvironment_enum"`,
    );
  }
}
