import { RelaxBetterAuthIssuer1778716800024 } from './migrations/1778716800024-relax-better-auth-issuer';

type AccountSchemaState = {
  hasAccountTable: boolean;
  hasIssuerColumn: boolean;
  issuerRequired: boolean;
  issuerDefault: string | null;
  hasIssuerAccountIdUniqueIndex: boolean;
};

type MigrationQueryRunner = {
  hasColumn: (table: string, column: string) => Promise<boolean>;
  query: (query: string) => Promise<void>;
};

const DROP_NOT_NULL = 'ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL';
// The index name is mixed-case, so Postgres only finds it when it is quoted.
const DROP_INDEX = 'DROP INDEX IF EXISTS "account_issuer_accountId_uidx"';

const createQueryRunner = (
  state: AccountSchemaState,
): {
  queryRunner: MigrationQueryRunner;
  queries: string[];
} => {
  const queries: string[] = [];

  const hasColumn = async (table: string, column: string): Promise<boolean> =>
    state.hasAccountTable &&
    state.hasIssuerColumn &&
    table === 'account' &&
    column === 'issuer';

  const query = async (statement: string): Promise<void> => {
    queries.push(statement);

    switch (statement) {
      case DROP_NOT_NULL:
        // Postgres rejects ALTER COLUMN on a column or table that is missing.
        if (!state.hasAccountTable || !state.hasIssuerColumn) {
          throw new Error('column "issuer" of relation "account" does not exist');
        }
        state.issuerRequired = false;
        return;
      case DROP_INDEX:
        // IF EXISTS makes this a no-op when the index (or table) is absent.
        state.hasIssuerAccountIdUniqueIndex = false;
        return;
      default:
        throw new Error(`Unexpected migration statement: ${statement}`);
    }
  };

  return {
    queryRunner: { hasColumn, query },
    queries,
  };
};

describe('RelaxBetterAuthIssuer1778716800024', () => {
  it('relaxes a production-shaped account table: NOT NULL without default and the issuer identity index', async () => {
    const state: AccountSchemaState = {
      hasAccountTable: true,
      hasIssuerColumn: true,
      hasIssuerAccountIdUniqueIndex: true,
      issuerDefault: null,
      issuerRequired: true,
    };
    const { queryRunner, queries } = createQueryRunner(state);

    await new RelaxBetterAuthIssuer1778716800024().up(queryRunner);

    expect(state).toEqual({
      hasAccountTable: true,
      hasIssuerColumn: true,
      hasIssuerAccountIdUniqueIndex: false,
      issuerDefault: null,
      issuerRequired: false,
    });
    expect(queries).toEqual([DROP_NOT_NULL, DROP_INDEX]);
  });

  it('relaxes a fresh-install account table whose issuer is NOT NULL with a default and keeps that default', async () => {
    const state: AccountSchemaState = {
      hasAccountTable: true,
      hasIssuerColumn: true,
      hasIssuerAccountIdUniqueIndex: true,
      issuerDefault: 'local:credential',
      issuerRequired: true,
    };
    const { queryRunner } = createQueryRunner(state);

    await new RelaxBetterAuthIssuer1778716800024().up(queryRunner);

    expect(state.issuerRequired).toBe(false);
    expect(state.hasIssuerAccountIdUniqueIndex).toBe(false);
    expect(state.hasIssuerColumn).toBe(true);
    expect(state.issuerDefault).toBe('local:credential');
  });

  it('never alters the column when the account table has no issuer column', async () => {
    const state: AccountSchemaState = {
      hasAccountTable: true,
      hasIssuerColumn: false,
      hasIssuerAccountIdUniqueIndex: false,
      issuerDefault: null,
      issuerRequired: false,
    };
    const { queryRunner, queries } = createQueryRunner(state);

    await new RelaxBetterAuthIssuer1778716800024().up(queryRunner);

    expect(queries).not.toContain(DROP_NOT_NULL);
    expect(queries).toEqual([DROP_INDEX]);
    expect(state.hasIssuerColumn).toBe(false);
  });

  it('is a no-op when the account table itself is absent', async () => {
    const state: AccountSchemaState = {
      hasAccountTable: false,
      hasIssuerColumn: false,
      hasIssuerAccountIdUniqueIndex: false,
      issuerDefault: null,
      issuerRequired: false,
    };
    const { queryRunner, queries } = createQueryRunner(state);

    await expect(
      new RelaxBetterAuthIssuer1778716800024().up(queryRunner),
    ).resolves.toBeUndefined();

    expect(queries).not.toContain(DROP_NOT_NULL);
    expect(state.hasAccountTable).toBe(false);
  });

  it('is idempotent: running it twice leaves the same relaxed schema', async () => {
    const state: AccountSchemaState = {
      hasAccountTable: true,
      hasIssuerColumn: true,
      hasIssuerAccountIdUniqueIndex: true,
      issuerDefault: null,
      issuerRequired: true,
    };
    const { queryRunner } = createQueryRunner(state);
    const migration = new RelaxBetterAuthIssuer1778716800024();

    await migration.up(queryRunner);
    const afterFirstRun = { ...state };
    await expect(migration.up(queryRunner)).resolves.toBeUndefined();

    expect(state).toEqual(afterFirstRun);
    expect(state.issuerRequired).toBe(false);
    expect(state.hasIssuerAccountIdUniqueIndex).toBe(false);
  });

  it('refuses a down migration so the relaxed constraint is never silently re-tightened', async () => {
    const state: AccountSchemaState = {
      hasAccountTable: true,
      hasIssuerColumn: true,
      hasIssuerAccountIdUniqueIndex: false,
      issuerDefault: null,
      issuerRequired: false,
    };
    const { queryRunner, queries } = createQueryRunner(state);

    await expect(
      new RelaxBetterAuthIssuer1778716800024().down(queryRunner),
    ).rejects.toThrow('cannot be reverted safely');
    expect(queries).toHaveLength(0);
  });
});
