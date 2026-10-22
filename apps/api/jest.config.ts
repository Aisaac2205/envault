import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // Coverage is opt-in (`pnpm test:coverage`); a plain `pnpm test` never collects it.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    // Process entry point: bootstraps Nest and listens on a port.
    '!src/main.ts',
    // TypeORM CLI data source and generated DDL migrations: they run against a real database.
    '!src/data-source.ts',
    '!src/database/migrations/**',
    // Barrel files that only re-export.
    '!src/**/index.ts',
  ],
  // Istanbul instrumentation (the Jest default, stated here on purpose): it counts real statements,
  // branches and functions and ran 3x or more faster than `v8` on this suite, where `v8` reports ranges.
  coverageProvider: 'babel',
  coverageDirectory: './coverage',
  coverageReporters: ['text-summary', 'lcovonly', 'html', 'json-summary'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest-setup.ts'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  // NestJS TestingModule with TypeORM can cause worker hangs in parallel.
  // maxWorkers: 1 ensures sequential execution for reliability.
  maxWorkers: 1,
  forceExit: true,
};

export default config;
