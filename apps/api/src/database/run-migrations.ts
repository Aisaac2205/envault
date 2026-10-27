import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../data-source';

// The slice of a TypeORM DataSource this runner needs. Kept narrow so unit
// tests can inject a fake without Postgres.
export interface MigrationDataSource {
  initialize(): Promise<unknown>;
  runMigrations(): Promise<ReadonlyArray<{ name: string }>>;
  destroy(): Promise<void>;
}

export interface RunPendingMigrationsOptions {
  /** Defaults to `process.env.DATABASE_URL`, read at call time. */
  databaseUrl?: string;
  createDataSource?: (url: string) => MigrationDataSource;
  logger?: Pick<Logger, 'log' | 'warn'>;
  /** Connection attempts before giving up. Mirrors `database.config.ts`. */
  retryAttempts?: number;
  /** Pause between connection attempts. Mirrors `database.config.ts`. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_ATTEMPTS = 10;
const DEFAULT_RETRY_DELAY_MS = 3000;

const defaultCreateDataSource = (url: string): MigrationDataSource =>
  new DataSource(buildDataSourceOptions(url));

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Brings the schema up to date before the application module is loaded.
 *
 * Better Auth validates the database schema when `auth.config.ts` is first
 * evaluated and caches a mismatch for the life of the process. Migrations
 * therefore cannot wait for `TypeOrmModule` (`migrationsRun`), which only runs
 * after that import. `main.ts` calls this first and loads the app afterwards.
 *
 * Resolves to the names of the migrations that ran. A failed migration is
 * rethrown so the boot stops, exactly as `migrationsRun` does.
 */
export async function runPendingMigrations(
  options: RunPendingMigrationsOptions = {},
): Promise<string[]> {
  const url = options.databaseUrl ?? process.env.DATABASE_URL;
  // Missing configuration is reported later by the ConfigModule validation,
  // with the full list of missing variables.
  if (!url) return [];

  const createDataSource = options.createDataSource ?? defaultCreateDataSource;
  const logger = options.logger ?? new Logger('Migrations');
  const retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  // Railway and Kubernetes can start the API before the database accepts
  // connections, a case `database.config.ts` already retries. Only the
  // connection is retried, never the migrations themselves.
  let dataSource: MigrationDataSource | undefined;
  for (let attempt = 1; dataSource === undefined; attempt++) {
    const candidate = createDataSource(url);
    try {
      await candidate.initialize();
      dataSource = candidate;
    } catch (error) {
      // A failed initialize() already tears the data source down.
      if (attempt >= retryAttempts) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Database not reachable (attempt ${attempt}/${retryAttempts}): ${reason}. Retrying in ${retryDelayMs}ms`,
      );
      await sleep(retryDelayMs);
    }
  }

  try {
    const executed = await dataSource.runMigrations();
    if (executed.length === 0) {
      logger.log('No pending migrations');
    } else {
      logger.log(
        `Executed ${executed.length} migration(s): ${executed.map((migration) => migration.name).join(', ')}`,
      );
    }
    return executed.map((migration) => migration.name);
  } finally {
    await dataSource.destroy();
  }
}
