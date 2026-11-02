import { ConnectionsPhysicalTargetUnique1778716800026 } from './migrations/1778716800026-connections-physical-target-unique';

type Duplicate = { dbType: string; host: string; port: number; database: string; names: string };

const createQueryRunner = (duplicates: Duplicate[] = []) => {
  const queries: string[] = [];
  return {
    queries,
    queryRunner: {
      query: async (statement: string): Promise<Duplicate[] | undefined> => {
        queries.push(statement);
        return /GROUP BY/i.test(statement) ? duplicates : undefined;
      },
    },
  };
};

const normalize = (statement: string): string => statement.replace(/\s+/g, ' ').trim();

describe('ConnectionsPhysicalTargetUnique1778716800026', () => {
  it('creates the partial unique index idempotently when there are no duplicates', async () => {
    const { queryRunner, queries } = createQueryRunner();

    await new ConnectionsPhysicalTargetUnique1778716800026().up(queryRunner as never);

    const create = normalize(queries[queries.length - 1]);
    expect(create).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "UQ_connections_physical_target"');
    expect(create).toContain('("dbType", lower(trim("host")), "port", "database")');
    expect(create).toContain('WHERE "isActive" = true');
  });

  it('aborts and lists the duplicates instead of choosing one to drop', async () => {
    const { queryRunner, queries } = createQueryRunner([
      { dbType: 'postgres', host: 'db.internal', port: 5432, database: 'orders', names: 'Orders PROD, Orders QA' },
    ]);

    await expect(
      new ConnectionsPhysicalTargetUnique1778716800026().up(queryRunner as never),
    ).rejects.toThrow(/Orders PROD, Orders QA/);
    expect(queries.some((q) => /CREATE UNIQUE INDEX/i.test(q))).toBe(false);
  });

  it('drops the index on down', async () => {
    const { queryRunner, queries } = createQueryRunner();

    await new ConnectionsPhysicalTargetUnique1778716800026().down(queryRunner as never);

    expect(normalize(queries[0])).toBe('DROP INDEX IF EXISTS "UQ_connections_physical_target"');
  });
});
