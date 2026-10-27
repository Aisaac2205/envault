import {
  MigrationDataSource,
  RunPendingMigrationsOptions,
  runPendingMigrations,
} from './run-migrations';

type RecordedCall = 'initialize' | 'runMigrations' | 'destroy';

const createFakeDataSource = (
  calls: RecordedCall[],
  overrides: Partial<MigrationDataSource> = {},
): MigrationDataSource => ({
  initialize: jest.fn(async () => {
    calls.push('initialize');
  }),
  runMigrations: jest.fn(async () => {
    calls.push('runMigrations');
    return [];
  }),
  destroy: jest.fn(async () => {
    calls.push('destroy');
  }),
  ...overrides,
});

const createOptions = (
  overrides: Partial<RunPendingMigrationsOptions> = {},
): {
  options: RunPendingMigrationsOptions;
  logger: { log: jest.Mock; warn: jest.Mock };
  sleep: jest.Mock;
} => {
  const logger = { log: jest.fn(), warn: jest.fn() };
  const sleep = jest.fn(async () => undefined);
  return {
    options: {
      databaseUrl: 'postgres://user:pass@db:5432/app',
      logger,
      sleep,
      ...overrides,
    },
    logger,
    sleep,
  };
};

describe('runPendingMigrations', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('initializes, runs the pending migrations and then destroys the data source, in that order', async () => {
    const calls: RecordedCall[] = [];
    const dataSource = createFakeDataSource(calls, {
      runMigrations: jest.fn(async () => {
        calls.push('runMigrations');
        return [{ name: 'AddOne1778716800024' }];
      }),
    });
    const createDataSource = jest.fn(() => dataSource);
    const { options } = createOptions({ createDataSource });

    const executed = await runPendingMigrations(options);

    expect(calls).toEqual(['initialize', 'runMigrations', 'destroy']);
    expect(createDataSource).toHaveBeenCalledWith(
      'postgres://user:pass@db:5432/app',
    );
    expect(executed).toEqual(['AddOne1778716800024']);
  });

  it('still destroys the data source and rethrows when a migration fails, so the boot stops', async () => {
    const calls: RecordedCall[] = [];
    const failure = new Error('migration exploded');
    const dataSource = createFakeDataSource(calls, {
      runMigrations: jest.fn(async () => {
        calls.push('runMigrations');
        throw failure;
      }),
    });
    const { options, logger } = createOptions({
      createDataSource: () => dataSource,
    });

    await expect(runPendingMigrations(options)).rejects.toBe(failure);

    expect(calls).toEqual(['initialize', 'runMigrations', 'destroy']);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('skips quietly without creating a data source when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const createDataSource = jest.fn();
    const { options, logger } = createOptions({
      databaseUrl: undefined,
      createDataSource,
    });

    await expect(runPendingMigrations(options)).resolves.toEqual([]);

    expect(createDataSource).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('treats an empty DATABASE_URL as not set', async () => {
    const createDataSource = jest.fn();
    const { options } = createOptions({ databaseUrl: '', createDataSource });

    await expect(runPendingMigrations(options)).resolves.toEqual([]);

    expect(createDataSource).not.toHaveBeenCalled();
  });

  it('reads DATABASE_URL from the environment when no url is passed', async () => {
    process.env.DATABASE_URL = 'postgres://env-host/app';
    const calls: RecordedCall[] = [];
    const createDataSource = jest.fn(() => createFakeDataSource(calls));
    const { logger, sleep } = createOptions();

    await runPendingMigrations({ createDataSource, logger, sleep });

    expect(createDataSource).toHaveBeenCalledWith('postgres://env-host/app');
  });

  it('logs how many migrations ran and their names', async () => {
    const calls: RecordedCall[] = [];
    const dataSource = createFakeDataSource(calls, {
      runMigrations: jest.fn(async () => [
        { name: 'First1778716800023' },
        { name: 'Second1778716800024' },
      ]),
    });
    const { options, logger } = createOptions({
      createDataSource: () => dataSource,
    });

    await runPendingMigrations(options);

    expect(logger.log).toHaveBeenCalledTimes(1);
    const message = String(logger.log.mock.calls[0][0]);
    expect(message).toContain('2');
    expect(message).toContain('First1778716800023');
    expect(message).toContain('Second1778716800024');
  });

  it('logs that nothing was pending when the schema is already current', async () => {
    const calls: RecordedCall[] = [];
    const { options, logger } = createOptions({
      createDataSource: () => createFakeDataSource(calls),
    });

    await expect(runPendingMigrations(options)).resolves.toEqual([]);

    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(String(logger.log.mock.calls[0][0])).toMatch(/no pending/i);
  });

  it('retries the connection while the database is not ready and then runs the migrations', async () => {
    const calls: RecordedCall[] = [];
    const unreachable = createFakeDataSource(calls, {
      initialize: jest.fn(async () => {
        throw new Error('connect ECONNREFUSED');
      }),
    });
    const ready = createFakeDataSource(calls);
    const createDataSource = jest
      .fn<MigrationDataSource, [string]>()
      .mockReturnValueOnce(unreachable)
      .mockReturnValueOnce(ready);
    const { options, logger, sleep } = createOptions({
      createDataSource,
      retryAttempts: 3,
      retryDelayMs: 250,
    });

    await runPendingMigrations(options);

    expect(createDataSource).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['initialize', 'runMigrations', 'destroy']);
    // A data source that never connected is cleaned up by TypeORM itself;
    // destroying it again would throw "not connected".
    expect(unreachable.destroy).not.toHaveBeenCalled();
  });

  it('gives up with the last connection error once the retry budget is spent and never runs migrations', async () => {
    const failure = new Error('connect ECONNREFUSED');
    const dataSource = createFakeDataSource([], {
      initialize: jest.fn(async () => {
        throw failure;
      }),
    });
    const createDataSource = jest.fn(() => dataSource);
    const { options, sleep } = createOptions({
      createDataSource,
      retryAttempts: 3,
      retryDelayMs: 10,
    });

    await expect(runPendingMigrations(options)).rejects.toBe(failure);

    expect(createDataSource).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(dataSource.destroy).not.toHaveBeenCalled();
  });

  it('never retries a failed migration', async () => {
    const failure = new Error('migration exploded');
    const dataSource = createFakeDataSource([], {
      runMigrations: jest.fn(async () => {
        throw failure;
      }),
    });
    const createDataSource = jest.fn(() => dataSource);
    const { options, sleep } = createOptions({
      createDataSource,
      retryAttempts: 5,
    });

    await expect(runPendingMigrations(options)).rejects.toBe(failure);

    expect(createDataSource).toHaveBeenCalledTimes(1);
    expect(dataSource.runMigrations).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
