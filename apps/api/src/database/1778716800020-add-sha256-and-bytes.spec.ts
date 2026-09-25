import { AddSha256AndBytesToBackupJobs1778716800020 } from './migrations/1778716800020-add-sha256-and-bytes-to-backup-jobs';

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

describe('AddSha256AndBytesToBackupJobs1778716800020', () => {
  it('adds sha256 and bytes columns to backup_jobs', async () => {
    const { queryRunner, queries } = createQueryRunner();
    const migration = new AddSha256AndBytesToBackupJobs1778716800020();

    await migration.up(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain(
      'ALTER TABLE "backup_jobs" ADD COLUMN IF NOT EXISTS "sha256" character varying(64)',
    );
    expect(joined).toContain(
      'ALTER TABLE "backup_jobs" ADD COLUMN IF NOT EXISTS "bytes" bigint',
    );
  });

  it('drops sha256 and bytes columns on down', async () => {
    const { queryRunner, queries } = createQueryRunner();
    const migration = new AddSha256AndBytesToBackupJobs1778716800020();

    await migration.down(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('ALTER TABLE "backup_jobs" DROP COLUMN "bytes"');
    expect(joined).toContain('ALTER TABLE "backup_jobs" DROP COLUMN "sha256"');
  });
});
