import { expect, test } from '@playwright/test';
import { parsePerfConfig } from '../../support/perf/config';
import type { EnvironmentInfo } from '../../support/perf/environment';
import {
  backupTimings,
  queueBackupMetrics,
  queueRestoreMetrics,
  restoreTimings,
  throughputMetrics,
} from '../../support/perf/measure';
import { aggregate, buildCsv, buildMarkdown, buildResults, CSV_COLUMNS, unitOf } from '../../support/perf/report';
import type { CaseRecord } from '../../support/perf/results';

// The report is arithmetic and string building, so it is tested on small,
// made-up cases whose answers can be checked by hand. No stack is involved.

const at = (seconds: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + seconds * 1000).toISOString();

const environment: EnvironmentInfo = {
  runId: '2026-01-01T00-00-00Z',
  generatedAt: at(0),
  git: { sha: '0123456789abcdef', dirty: false },
  node: 'v24.0.0',
  playwright: '1.63.0',
  host: { os: 'Test OS 1', arch: 'x64', cpus: 8, cpuModel: 'Test CPU', memoryGiB: 32 },
  docker: { serverVersion: '29.0.0', cpus: 16, memoryGiB: 15.5 },
  tools: {},
  variables: {},
};

function throughputCase(): CaseRecord {
  const metrics = (backupMs: number, restoreMs: number) =>
    throughputMetrics({
      sourceBytes: 100 * 1024 * 1024,
      dumpBytes: 50 * 1024 * 1024,
      backup: { jobId: 'b', createdAt: 0, startedAt: 10, completedAt: 10 + backupMs, queueWaitMs: 10, durationMs: backupMs },
      backupWallMs: backupMs + 100,
      restore: { jobId: 'r', createdAt: 0, startedAt: 2, completedAt: 2 + restoreMs, queueWaitMs: 2, durationMs: restoreMs },
      restoreWallMs: restoreMs + 100,
    });
  return {
    group: 'throughput',
    id: 'postgres/medium',
    labels: { engine: 'postgres', size: 'medium' },
    startedAt: at(0),
    complete: true,
    meta: {
      serverVersion: '18.0',
      dataset: {
        targetMiB: 100,
        sourceBytes: 100 * 1024 * 1024,
        indexBytes: 10 * 1024 * 1024,
        customers: 15000,
        orders: 60000,
        events: 240000,
        seedMs: 3000,
      },
    },
    samples: [
      // The warm-up is slow on purpose: it must not reach any statistic.
      { run: 0, warmup: true, metrics: metrics(9000, 9000) },
      { run: 1, warmup: false, metrics: metrics(2000, 1000) },
      { run: 2, warmup: false, metrics: metrics(4000, 3000) },
      { run: 3, warmup: false, metrics: metrics(3000, 2000) },
    ],
  };
}

test.describe('timings from job rows', () => {
  test('a backup is timed from its own timestamps', () => {
    const timings = backupTimings({
      id: 'job',
      createdAt: at(0),
      startedAt: at(0.25),
      completedAt: at(12.25),
    });
    expect(timings).toMatchObject({ queueWaitMs: 250, durationMs: 12_000 });
  });

  test('timestamps out of order or missing are an error, not a number', () => {
    expect(() => backupTimings({ id: 'j', createdAt: at(5), startedAt: at(1), completedAt: at(9) })).toThrow(/out of order/);
    expect(() => backupTimings({ id: 'j', createdAt: at(0), startedAt: null, completedAt: at(9) })).toThrow(/startedAt/);
    expect(() => restoreTimings({ id: 'j', createdAt: at(0), startedAt: at(9), completedAt: at(1) })).toThrow(/out of order/);
  });

  test('throughput is the source and the dump size over the job duration', () => {
    const metrics = throughputMetrics({
      sourceBytes: 100 * 1024 * 1024,
      dumpBytes: 40 * 1024 * 1024,
      backup: { jobId: 'b', createdAt: 0, startedAt: 5, completedAt: 2005, queueWaitMs: 5, durationMs: 2000 },
      backupWallMs: 2300,
      restore: { jobId: 'r', createdAt: 0, startedAt: 3, completedAt: 4003, queueWaitMs: 3, durationMs: 4000 },
      restoreWallMs: 4200,
    });
    expect(metrics).toMatchObject({
      'backup.durationMs': 2000,
      'backup.sourceMiBps': 50,
      'backup.dumpMiBps': 20,
      'restore.queueWaitMs': 3,
      'restore.sourceMiBps': 25,
      'restore.dumpMiBps': 10,
      'backup.dumpBytes': 40 * 1024 * 1024,
    });
  });
});

test.describe('queue metrics', () => {
  // Six backups on two workers, 1 s each: starts at 0, 0, 1, 1, 2, 2.
  const staircase = [0, 0, 1, 1, 2, 2].map((startedAt, index) =>
    backupTimings({ id: `j${index}`, createdAt: at(0), startedAt: at(startedAt), completedAt: at(startedAt + 1) }),
  );

  test('backups form a staircase of queue waits by start order', () => {
    const metrics = queueBackupMetrics([...staircase].reverse());
    expect(metrics).toMatchObject({
      makespanMs: 3000,
      queueWaitMaxMs: 2000,
      queueWaitMeanMs: 1000,
      durationMeanMs: 1000,
      parallelism: 2,
      'rank1.queueWaitMs': 0,
      'rank2.queueWaitMs': 0,
      'rank3.queueWaitMs': 1000,
      'rank4.queueWaitMs': 1000,
      'rank5.queueWaitMs': 2000,
      'rank6.queueWaitMs': 2000,
    });
  });

  test('restores are ranked by completion and show the wait and the gap between them', () => {
    // One restore worker: the second job is admitted with the first, starts at 3 s and ends at 6 s.
    const metrics = queueRestoreMetrics([
      restoreTimings({ id: 'b', createdAt: at(0), startedAt: at(3), completedAt: at(6) }),
      restoreTimings({ id: 'a', createdAt: at(0), startedAt: at(0), completedAt: at(3) }),
    ]);
    expect(metrics).toEqual({
      makespanMs: 6000,
      queueWaitMaxMs: 3000,
      completionGapMs: 3000,
      'done1.queueWaitMs': 0,
      'done1.durationMs': 3000,
      'done2.queueWaitMs': 3000,
      'done2.durationMs': 3000,
    });
    expect(queueRestoreMetrics([restoreTimings({ id: 'a', createdAt: at(0), startedAt: at(0), completedAt: at(3) })])).toEqual({
      makespanMs: 3000,
      queueWaitMaxMs: 0,
      'done1.queueWaitMs': 0,
      'done1.durationMs': 3000,
    });
  });
});

test.describe('aggregation', () => {
  test('statistics cover the measured samples and leave the warm-up out', () => {
    const [stats] = aggregate([throughputCase()]);
    const duration = stats.stats['backup.durationMs'];
    expect(duration).toMatchObject({ n: 3, min: 2000, p50: 3000, max: 4000, mean: 3000 });
    // 3 values, rank 2 * 0.95 = 1.9: 3000 + 0.9 * (4000 - 3000)
    expect(duration.p95).toBeCloseTo(3900, 8);
    expect(stats.stats['restore.durationMs']).toMatchObject({ n: 3, p50: 2000 });
    // The warm-up stays in the raw samples.
    expect(stats.samples).toHaveLength(4);
  });

  test('a case with only a warm-up has no statistics', () => {
    const record = throughputCase();
    record.samples = record.samples.slice(0, 1);
    expect(aggregate([record])[0].stats).toEqual({});
  });

  test('the unit comes from the end of the metric name', () => {
    expect(unitOf('backup.durationMs')).toBe('ms');
    expect(unitOf('rank3.queueWaitMs')).toBe('ms');
    expect(unitOf('backup.dumpBytes')).toBe('B');
    expect(unitOf('restore.sourceMiBps')).toBe('MiB/s');
    expect(unitOf('requestsCount')).toBe('');
  });
});

test.describe('summary.csv', () => {
  test('has one row per case and metric, every row with the header’s columns', () => {
    const csv = buildCsv(aggregate([throughputCase()]));
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(1 + 11);
    for (const line of lines) {
      expect(line.split(',')).toHaveLength(CSV_COLUMNS.length);
    }
    expect(lines).toContain('throughput,postgres/medium,backup.durationMs,ms,3,2000,3000,3900,3980,4000,3000,1000,true');
  });

  test('quotes the cells that contain commas or quotes', () => {
    const record: CaseRecord = {
      group: 'api',
      id: 'GET a,b "c"',
      labels: { endpoint: 'x' },
      startedAt: at(0),
      complete: false,
      meta: {},
      samples: [{ run: 1, warmup: false, metrics: { latencyMs: 5 } }],
    };
    const [, row] = buildCsv(aggregate([record])).trimEnd().split('\n');
    expect(row).toBe('api,"GET a,b ""c""",latencyMs,ms,1,5,5,5,5,5,5,0,false');
  });
});

test.describe('summary.md and results.json', () => {
  const cases = aggregate([throughputCase()]);
  const markdown = buildMarkdown({ environment, config: parsePerfConfig({}), cases });

  test('every table row has as many cells as its header', () => {
    const blocks = markdown.split('\n\n').filter((block) => block.startsWith('|'));
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const block of blocks) {
      const [header, ...rows] = block.split('\n');
      const columns = header.split('|').length;
      for (const row of rows) {
        expect(row.split('|').length, row).toBe(columns);
      }
    }
  });

  test('puts the figures where a reader looks for them', () => {
    expect(markdown).toContain('| Engine | Size | n | min | p50 | p95 | max | mean | σ |');
    // 2.00, 3.00, 3.90 and 4.00 s, the median of the backup duration
    expect(markdown).toContain('| PostgreSQL | medium | 3 | 2.00 | 3.00 | 3.90 | 4.00 | 3.00 | 1.00 |');
    expect(markdown).toContain('| Source PostgreSQL | 18.0 |');
    expect(markdown).toContain('`0123456789`');
    expect(markdown).toContain('| Test host | Test OS 1 x64, 8 × Test CPU, 32 GiB |');
    expect(markdown).toContain('| Docker VM | 16 CPUs, 15.5 GiB, Docker 29.0.0 |');
  });

  test('marks a case that did not finish', () => {
    const unfinished = aggregate([{ ...throughputCase(), complete: false }]);
    expect(buildMarkdown({ environment, config: parsePerfConfig({}), cases: unfinished })).toContain('| PostgreSQL | medium* |');
  });

  test('results.json keeps the raw samples, the statistics and the method', () => {
    const results = buildResults({ environment, config: parsePerfConfig({}), cases });
    expect(results).toMatchObject({ schema: 1, runId: environment.runId });
    const [first] = results.cases as { samples: unknown[]; stats: Record<string, unknown> }[];
    expect(first.samples).toHaveLength(4);
    expect(Object.keys(first.stats)).toContain('backup.durationMs');
    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
  });
});
