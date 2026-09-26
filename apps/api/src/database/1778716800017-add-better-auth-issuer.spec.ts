import { AddBetterAuthIssuer1778716800017 } from './migrations/1778716800017-add-better-auth-issuer';

type AccountRow = {
  accountId: string;
  issuer: string | null;
  providerId: string;
  userId: string;
};

type MigrationState = {
  accounts: AccountRow[];
  hasIssuerColumn: boolean;
  hasIssuerAccountIdUniqueIndex: boolean;
  issuerRequired: boolean;
};

type MigrationQueryRunner = {
  query: (query: string) => Promise<void>;
};

const createQueryRunner = (state: MigrationState): {
  queryRunner: MigrationQueryRunner;
  queries: string[];
} => {
  const queries: string[] = [];

  const query = async (statement: string): Promise<void> => {
    queries.push(statement);

    switch (statement) {
      case 'ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text':
        state.hasIssuerColumn = true;
        return;
      case 'UPDATE "account" SET "issuer" = \'local:credential\', "accountId" = "userId" WHERE "providerId" = \'credential\' AND "issuer" IS NULL':
        state.accounts = state.accounts.map((account) =>
          account.providerId === 'credential' && account.issuer === null
            ? {
                ...account,
                accountId: account.userId,
                issuer: 'local:credential',
              }
            : account,
        );
        return;
      case 'ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL':
        if (state.accounts.some((account) => account.issuer === null)) {
          throw new Error('issuer cannot be null');
        }
        state.issuerRequired = true;
        return;
      case 'CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_uidx" ON "account" ("issuer", "accountId")': {
        const accountKeys = new Set(
          state.accounts.map((account) => `${account.issuer}:${account.accountId}`),
        );
        if (accountKeys.size !== state.accounts.length) {
          throw new Error('duplicate issuer and accountId');
        }
        state.hasIssuerAccountIdUniqueIndex = true;
        return;
      }
      default:
        throw new Error(`Unexpected migration statement: ${statement}`);
    }
  };

  return {
    queryRunner: { query },
    queries,
  };
};

describe('AddBetterAuthIssuer1778716800017', () => {
  it('backfills each credential account to the Better Auth 1.7 credential identity and enforces its schema contract', async () => {
    const state: MigrationState = {
      accounts: [
        {
          accountId: 'legacy-account-id',
          issuer: null,
          providerId: 'credential',
          userId: 'user-1',
        },
      ],
      hasIssuerAccountIdUniqueIndex: false,
      hasIssuerColumn: false,
      issuerRequired: false,
    };
    const { queryRunner } = createQueryRunner(state);
    const migration = new AddBetterAuthIssuer1778716800017();

    await migration.up(queryRunner);

    expect(state).toEqual({
      accounts: [
        {
          accountId: 'user-1',
          issuer: 'local:credential',
          providerId: 'credential',
          userId: 'user-1',
        },
      ],
      hasIssuerAccountIdUniqueIndex: true,
      hasIssuerColumn: true,
      issuerRequired: true,
    });
  });

  it('fails closed rather than inventing an issuer for an unsupported legacy provider', async () => {
    const state: MigrationState = {
      accounts: [
        {
          accountId: 'provider-subject',
          issuer: null,
          providerId: 'unknown-provider',
          userId: 'user-1',
        },
      ],
      hasIssuerAccountIdUniqueIndex: false,
      hasIssuerColumn: false,
      issuerRequired: false,
    };
    const { queryRunner, queries } = createQueryRunner(state);
    const migration = new AddBetterAuthIssuer1778716800017();

    await expect(migration.up(queryRunner)).rejects.toThrow('issuer cannot be null');

    expect(state.hasIssuerAccountIdUniqueIndex).toBe(false);
    expect(queries).toHaveLength(3);
  });

  it('fails before creating the identity index when duplicate credential rows resolve to one Better Auth account identity', async () => {
    const state: MigrationState = {
      accounts: [
        {
          accountId: 'legacy-account-id-1',
          issuer: null,
          providerId: 'credential',
          userId: 'user-1',
        },
        {
          accountId: 'legacy-account-id-2',
          issuer: null,
          providerId: 'credential',
          userId: 'user-1',
        },
      ],
      hasIssuerAccountIdUniqueIndex: false,
      hasIssuerColumn: false,
      issuerRequired: false,
    };
    const { queryRunner, queries } = createQueryRunner(state);
    const migration = new AddBetterAuthIssuer1778716800017();

    await expect(migration.up(queryRunner)).rejects.toThrow(
      'duplicate issuer and accountId',
    );

    expect(state.accounts).toEqual([
      {
        accountId: 'user-1',
        issuer: 'local:credential',
        providerId: 'credential',
        userId: 'user-1',
      },
      {
        accountId: 'user-1',
        issuer: 'local:credential',
        providerId: 'credential',
        userId: 'user-1',
      },
    ]);
    expect(state.hasIssuerAccountIdUniqueIndex).toBe(false);
    expect(queries).toHaveLength(4);
  });
  it('refuses a down migration so issuer identities are never destructively erased while Better Auth 1.7 is deployed', async () => {
    const state: MigrationState = {
      accounts: [],
      hasIssuerAccountIdUniqueIndex: false,
      hasIssuerColumn: false,
      issuerRequired: false,
    };
    const { queryRunner, queries } = createQueryRunner(state);
    const migration = new AddBetterAuthIssuer1778716800017();

    await expect(migration.down(queryRunner)).rejects.toThrow(
      'Cannot safely revert Better Auth issuer identity migration while Better Auth 1.7 is deployed',
    );
    expect(queries).toHaveLength(0);
  });
});
