import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One active connection per physical target: (dbType, host, port, database),
 * with the host compared trimmed and case-insensitive. Without it a PROD
 * database can also be registered under a QA label.
 *
 * Which of two duplicates is the right one is a human call (it decides which
 * environment label survives), so `up()` never picks: it aborts and lists the
 * duplicates. Resolve them (delete or repoint one), then run the migration again.
 */
export class ConnectionsPhysicalTargetUnique1778716800026 implements MigrationInterface {
  name = 'ConnectionsPhysicalTargetUnique1778716800026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: Array<{
      dbType: string;
      host: string;
      port: number;
      database: string;
      names: string;
    }> = await queryRunner.query(`
      SELECT "dbType", lower(trim("host")) AS host, "port", "database",
             string_agg(name || ' (' || environment || ')', ', ' ORDER BY name) AS names
      FROM connections
      WHERE "isActive" = true
      GROUP BY "dbType", lower(trim("host")), "port", "database"
      HAVING count(*) > 1
    `);

    if (duplicates.length > 0) {
      const list = duplicates
        .map((d) => `${d.dbType} ${d.host}:${d.port}/${d.database} -> ${d.names}`)
        .join('; ');
      throw new Error(
        `Cannot enforce one connection per physical target. Duplicate active connections: ${list}. ` +
          'Delete or repoint the extra ones, then run the migration again.',
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_connections_physical_target"
      ON "connections" ("dbType", lower(trim("host")), "port", "database")
      WHERE "isActive" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_connections_physical_target"');
  }
}
