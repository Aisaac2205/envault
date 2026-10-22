import { engines, postgresVersionNumber, uniqueDatabaseName, type DbType, type Engine } from './databases';
import { expect, test as base, type Connection } from './fixtures';
import { JobRunner, type BackupJob } from './jobs';
import type { Fingerprint } from './seed-data';
import type { SourceDatabase } from './sources';

/** A database on one of the stack's source servers that a test created. */
export interface TestDatabase {
  engine: Engine;
  name: string;
  /** What the API needs to connect to it. */
  settings: SourceDatabase;
}

/** A seeded `prod` database, the connection to it and one completed backup of it. */
export interface BackedUpDatabase {
  database: TestDatabase;
  connection: Connection;
  backup: BackupJob;
  /** Structure and data of the database when it was backed up. */
  fingerprint: Fingerprint;
}

interface PipelineFixtures {
  /** Creates databases on the source servers and drops them when the test ends. */
  newDatabase: (dbType: DbType, contents: 'seeded' | 'empty') => Promise<TestDatabase>;
  /** Seeds a database, registers it as a `prod` connection and backs it up. */
  backedUp: (dbType: DbType) => Promise<BackedUpDatabase>;
  /** Registers an empty database as a restore target in the given environment. */
  restoreTarget: (dbType: DbType, environment: 'dev' | 'qa' | 'prod') => Promise<{
    database: TestDatabase;
    connection: Connection;
  }>;
  /** Starts and follows backup and restore jobs; stops and cleans up what is left. */
  jobs: JobRunner;
}

interface PipelineWorkerFixtures {
  /** `server_version_num` of the source PostgreSQL, for the restore specs that depend on it. */
  postgresVersion: number;
}

const SHORT_NAME: Record<DbType, string> = { postgres: 'pg', mysql: 'my' };

export const test = base.extend<PipelineFixtures, PipelineWorkerFixtures>({
  newDatabase: async ({}, use) => {
    const created: TestDatabase[] = [];

    await use(async (dbType, contents) => {
      const engine = engines[dbType];
      const name = uniqueDatabaseName(`${SHORT_NAME[dbType]}_${contents === 'seeded' ? 'src' : 'dst'}`);
      const database: TestDatabase = { engine, name, settings: engine.settings(name) };
      // Registered before it exists, so a failure half-way is still cleaned up.
      created.push(database);

      await engine.createDatabase(name);
      if (contents === 'seeded') {
        await engine.seed(name);
      }
      return database;
    });

    // Every drop is attempted before reporting, as in the connection cleanup.
    const failures: string[] = [];
    for (const { engine, name } of created.reverse()) {
      try {
        await engine.drop(name);
      } catch (error) {
        failures.push(`${name} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    expect(failures, 'Databases left behind by the test').toEqual([]);
  },

  // `createConnection` and `newDatabase` are listed although `jobs` does not
  // use them: fixtures are torn down in reverse order of their set-up, so this
  // makes the jobs stop first, before their connections and databases go away.
  jobs: async ({ adminApi, createConnection, newDatabase }, use) => {
    const runner = new JobRunner(adminApi);
    await use(runner);
    await runner.cleanUp();
  },

  backedUp: async ({ newDatabase, createConnection, jobs }, use) => {
    await use(async (dbType) => {
      const database = await newDatabase(dbType, 'seeded');
      const fingerprint = await database.engine.inspect(database.name);
      const { connection } = await createConnection({ ...database.settings, environment: 'prod' });
      const backup = await jobs.backup(connection.id);
      return { database, connection, backup, fingerprint };
    });
  },

  restoreTarget: async ({ newDatabase, createConnection }, use) => {
    await use(async (dbType, environment) => {
      const database = await newDatabase(dbType, 'empty');
      const { connection } = await createConnection({ ...database.settings, environment });
      return { database, connection };
    });
  },

  postgresVersion: [
    async ({}, use) => {
      await use(await postgresVersionNumber());
    },
    { scope: 'worker' },
  ],
});

export { expect };
