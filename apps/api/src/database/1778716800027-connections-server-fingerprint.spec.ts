import { ConnectionsServerFingerprint1778716800027 } from './migrations/1778716800027-connections-server-fingerprint';

const createQueryRunner = () => {
  const queries: string[] = [];
  return { queries, queryRunner: { query: async (statement: string) => void queries.push(statement) } };
};

describe('ConnectionsServerFingerprint1778716800027', () => {
  it('adds the column idempotently, nullable', async () => {
    const { queryRunner, queries } = createQueryRunner();

    await new ConnectionsServerFingerprint1778716800027().up(queryRunner as never);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/ADD COLUMN IF NOT EXISTS "serverFingerprint" character varying$/);
  });

  it('drops the column on down', async () => {
    const { queryRunner, queries } = createQueryRunner();

    await new ConnectionsServerFingerprint1778716800027().down(queryRunner as never);

    expect(queries[0]).toMatch(/DROP COLUMN IF EXISTS "serverFingerprint"/);
  });
});
