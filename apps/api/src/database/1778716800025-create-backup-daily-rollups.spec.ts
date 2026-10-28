import { CreateBackupDailyRollups1778716800025 } from './migrations/1778716800025-create-backup-daily-rollups';

type MigrationQueryRunner = {
  query: (query: string) => Promise<void>;
};

const createQueryRunner = (): {
  queryRunner: MigrationQueryRunner;
  queries: string[];
} => {
  const queries: string[] = [];
  return {
    queryRunner: {
      query: async (statement: string): Promise<void> => {
        queries.push(statement);
      },
    },
    queries,
  };
};

const normalize = (statement: string): string => statement.replace(/\s+/g, ' ').trim();

describe('CreateBackupDailyRollups1778716800025', () => {
  it('creates backup_daily_rollups idempotently', async () => {
    const { queryRunner, queries } = createQueryRunner();
    const migration = new CreateBackupDailyRollups1778716800025();

    await migration.up(queryRunner as never);

    expect(queries).toHaveLength(1);
    const statement = normalize(queries[0]);
    expect(statement).toContain('CREATE TABLE IF NOT EXISTS "backup_daily_rollups"');
  });

  it('uses a (connectionId, day) composite primary key and no foreign key', async () => {
    const { queryRunner, queries } = createQueryRunner();
    const migration = new CreateBackupDailyRollups1778716800025();

    await migration.up(queryRunner as never);

    const statement = normalize(queries.join('\n'));
    expect(statement).toContain(
      'CONSTRAINT "PK_backup_daily_rollups" PRIMARY KEY ("connectionId", "day")',
    );
    // The rollup must outlive soft-deleted connections and purged job rows.
    expect(statement).not.toContain('FOREIGN KEY');
    expect(statement).not.toContain('REFERENCES');
  });

  it('declares the aggregate columns with their types and defaults', async () => {
    const { queryRunner, queries } = createQueryRunner();
    const migration = new CreateBackupDailyRollups1778716800025();

    await migration.up(queryRunner as never);

    const statement = normalize(queries.join('\n'));
    expect(statement).toContain('"connectionId" character varying NOT NULL');
    expect(statement).toContain('"day" date NOT NULL');
    expect(statement).toContain('"completed" integer NOT NULL DEFAULT 0');
    expect(statement).toContain('"failed" integer NOT NULL DEFAULT 0');
    expect(statement).toContain('"totalSizeMb" double precision NOT NULL DEFAULT 0');
    expect(statement).toContain(
      `"durationsSeconds" double precision array NOT NULL DEFAULT '{}'`,
    );
    expect(statement).toContain('"updatedAt" TIMESTAMP NOT NULL DEFAULT now()');
  });

  it('drops the table on down', async () => {
    const { queryRunner, queries } = createQueryRunner();
    const migration = new CreateBackupDailyRollups1778716800025();

    await migration.down(queryRunner as never);

    expect(queries.map(normalize)).toEqual(['DROP TABLE IF EXISTS "backup_daily_rollups"']);
  });
});
