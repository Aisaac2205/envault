import { expect, test, type PlaywrightTestConfig } from '@playwright/test';
import functionalConfig from '../../playwright.config';
import perfConfig from '../../playwright.perf.config';
import {
  caseTimeoutMs,
  jobTimeoutMs,
  parsePerfConfig,
  seedTimeoutMs,
  SIZE_NAMES,
  TARGET_MIB,
} from '../../support/perf/config';
import { idRanges, planFor, rowsOf } from '../../support/perf/datasets';

// The settings of the performance run, the dataset plans and, above all, the
// wiring that keeps this suite out of `pnpm test:e2e`. No stack is involved.

const projectNames = (config: PlaywrightTestConfig): string[] => (config.projects ?? []).map(({ name }) => name ?? '');

test.describe('gating', () => {
  test('the functional config has no performance project and matches no performance spec', () => {
    expect(projectNames(functionalConfig)).toEqual(['setup', 'api', 'pipeline', 'ui-chromium']);

    const specs = ['backup-restore.perf.spec.ts', 'stats.unit.spec.ts', 'concurrency.perf.spec.ts'];
    for (const project of functionalConfig.projects ?? []) {
      const patterns = [project.testMatch].flat().filter((pattern): pattern is RegExp => pattern instanceof RegExp);
      for (const spec of specs) {
        // A project matches a file only inside its own test directory; the pattern alone must not match either.
        expect(patterns.some((pattern) => pattern.test(spec)), `${project.name} matches ${spec}`).toBe(false);
      }
    }
  });

  test('the performance config has the unit, setup and perf projects, and runs one test at a time', () => {
    expect(projectNames(perfConfig)).toEqual(['perf-unit', 'setup', 'perf']);
    expect(perfConfig.workers).toBe(1);
    expect(perfConfig.fullyParallel).toBe(false);
    expect(perfConfig.retries).toBe(0);

    const byName = Object.fromEntries((perfConfig.projects ?? []).map((project) => [project.name, project]));
    // A broken helper stops the run before the long measurements.
    expect(byName['perf-unit'].dependencies ?? []).toEqual([]);
    expect(byName.setup.dependencies).toEqual(['perf-unit']);
    expect(byName.perf.dependencies).toEqual(['setup']);
  });

  test('the performance config keeps its output apart from the functional one', () => {
    expect(perfConfig.outputDir).not.toBe(functionalConfig.outputDir);
  });
});

test.describe('settings', () => {
  test('the defaults are the full preset', () => {
    const config = parsePerfConfig({});
    expect(config).toMatchObject({
      preset: 'full',
      engines: ['postgres', 'mysql'],
      sizes: ['small', 'medium', 'large'],
      queue: { size: 'medium', backupConcurrencies: [1, 2, 4, 6], restoreConcurrencies: [1, 2] },
    });
    expect(config.sizes).not.toContain('xlarge');
  });

  test('the quick preset is a smoke check', () => {
    const config = parsePerfConfig({ E2E_PERF_PRESET: 'quick' });
    expect(config.preset).toBe('quick');
    expect(config.sizes).toEqual(['small']);
    expect(config.runs.small).toBeLessThanOrEqual(3);
    expect(config.queue.size).toBe('small');
  });

  test('a variable wins over the preset', () => {
    const config = parsePerfConfig({
      E2E_PERF_PRESET: 'quick',
      E2E_PERF_ENGINES: ' MySQL ',
      E2E_PERF_SIZES: 'medium,xlarge,medium',
      E2E_PERF_RUNS: '7',
      E2E_PERF_QUEUE_K: '6, 2,2',
      E2E_PERF_UI_RUNS: '2',
    });
    expect(config.engines).toEqual(['mysql']);
    expect(config.sizes).toEqual(['medium', 'xlarge']);
    expect(config.runs).toEqual({ small: 7, medium: 7, large: 7, xlarge: 7 });
    expect(config.queue.backupConcurrencies).toEqual([2, 6]);
    expect(config.frontend.loads).toBe(2);
    expect(config.frontend.wideLoads).toBeLessThanOrEqual(2);
  });

  test('empty variables fall back to the preset', () => {
    expect(parsePerfConfig({ E2E_PERF_SIZES: '  ', E2E_PERF_RUNS: '' })).toEqual(parsePerfConfig({}));
  });

  test('a value that makes no sense is rejected with a message that says what is valid', () => {
    expect(() => parsePerfConfig({ E2E_PERF_ENGINES: 'oracle' })).toThrow(/E2E_PERF_ENGINES.*unknown: oracle.*postgres, mysql/);
    expect(() => parsePerfConfig({ E2E_PERF_SIZES: 'huge' })).toThrow(/E2E_PERF_SIZES.*small, medium, large, xlarge/);
    expect(() => parsePerfConfig({ E2E_PERF_RUNS: '0' })).toThrow(/E2E_PERF_RUNS/);
    expect(() => parsePerfConfig({ E2E_PERF_RUNS: 'many' })).toThrow(/whole number/);
    expect(() => parsePerfConfig({ E2E_PERF_QUEUE_K: '1,x' })).toThrow(/E2E_PERF_QUEUE_K/);
    expect(() => parsePerfConfig({ E2E_PERF_PRESET: 'slow' })).toThrow(/"full" or "quick"/);
  });

  test('deadlines grow with the dataset', () => {
    const sizes = [...SIZE_NAMES];
    for (const [index, size] of sizes.entries()) {
      if (index > 0) {
        expect(jobTimeoutMs(size)).toBeGreaterThan(jobTimeoutMs(sizes[index - 1]));
        expect(seedTimeoutMs(size)).toBeGreaterThan(seedTimeoutMs(sizes[index - 1]));
      }
    }
    expect(caseTimeoutMs('large', 5)).toBeGreaterThan(caseTimeoutMs('large', 3));
    // The API gives a dump 30 minutes by default; the largest deadline stays in that range.
    expect(jobTimeoutMs('xlarge')).toBeGreaterThanOrEqual(30 * 60_000 * 0.8);
  });
});

test.describe('datasets', () => {
  test('sizes are in the ratio of their names and each table is a multiple of its parent', () => {
    expect(TARGET_MIB).toEqual({ small: 10, medium: 100, large: 500, xlarge: 1024 });
    for (const size of SIZE_NAMES) {
      const plan = planFor(size);
      expect(plan.orders).toBe(plan.customers * 4);
      expect(plan.events).toBe(plan.orders * 4);
      expect(rowsOf(plan)).toEqual({
        perf_customers: plan.customers,
        perf_orders: plan.orders,
        perf_events: plan.events,
      });
    }
    // Both engines need 6.2 to 6.7 MiB per 1000 customers, so one row count per size lands near each target.
    for (const size of SIZE_NAMES) {
      const mibPerThousand = TARGET_MIB[size] / (planFor(size).customers / 1000);
      expect(mibPerThousand).toBeGreaterThan(6.2);
      expect(mibPerThousand).toBeLessThan(7.0);
    }
  });

  test('id ranges cover every id once, without gaps, in chunks', () => {
    expect(idRanges(10, 4)).toEqual([[1, 4], [5, 8], [9, 10]]);
    expect(idRanges(8, 4)).toEqual([[1, 4], [5, 8]]);
    expect(idRanges(3, 100)).toEqual([[1, 3]]);
    expect(idRanges(0, 5)).toEqual([]);
  });
});
