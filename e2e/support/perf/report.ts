import type { PerfConfig } from './config';
import type { DatasetInfo } from './datasets';
import type { EnvironmentInfo } from './environment';
import type { CaseRecord, Group } from './results';
import { round, summarize, toMiB, type Summary } from './stats';

/**
 * Turns what the specs recorded into the three files of a run: `results.json`
 * (raw samples, statistics, environment), `summary.csv` (one row per case and
 * metric) and `summary.md` (tables to paste into a report). Pure functions, so
 * the tables and the arithmetic are unit-tested without a stack.
 */

export interface CaseStats extends CaseRecord {
  /** One summary per metric, over the measured samples only: warm-ups are left out. */
  stats: Record<string, Summary>;
}

export function aggregate(cases: readonly CaseRecord[]): CaseStats[] {
  return cases.map((record) => {
    const measured = record.samples.filter((sample) => !sample.warmup);
    const names = [...new Set(measured.flatMap((sample) => Object.keys(sample.metrics)))];
    const stats: Record<string, Summary> = {};
    for (const name of names) {
      const values = measured.map((sample) => sample.metrics[name]).filter((value) => Number.isFinite(value));
      if (values.length > 0) {
        stats[name] = summarize(values);
      }
    }
    return { ...record, stats };
  });
}

const UNITS: [suffix: string, unit: string][] = [
  ['Ms', 'ms'],
  ['Bytes', 'B'],
  ['MiBps', 'MiB/s'],
  ['parallelism', 'jobs'],
];

/** The unit of a metric, read off the end of its name. */
export function unitOf(metric: string): string {
  return UNITS.find(([suffix]) => metric.endsWith(suffix))?.[1] ?? '';
}

// ── summary.csv ─────────────────────────────────────────────────

export const CSV_COLUMNS = [
  'group', 'case', 'metric', 'unit', 'n', 'min', 'p50', 'p95', 'p99', 'max', 'mean', 'stddev', 'complete',
] as const;

const csvCell = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One row per case and metric, with the unit in its own column so a spreadsheet can pivot on it. */
export function buildCsv(cases: readonly CaseStats[]): string {
  const rows = cases.flatMap((record) =>
    Object.entries(record.stats).map(([metric, s]) =>
      [
        record.group, record.id, metric, unitOf(metric), s.n,
        round(s.min), round(s.p50), round(s.p95), round(s.p99), round(s.max), round(s.mean), round(s.stddev),
        record.complete,
      ].map(csvCell).join(','),
    ),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}

// ── results.json ────────────────────────────────────────────────

export function buildResults(input: {
  environment: EnvironmentInfo;
  config: PerfConfig;
  cases: readonly CaseStats[];
}): Record<string, unknown> {
  return {
    schema: 1,
    runId: input.environment.runId,
    generatedAt: input.environment.generatedAt,
    environment: input.environment,
    config: input.config,
    method: {
      percentile: 'linear interpolation between closest ranks (R-7: NumPy linear, Excel PERCENTILE.INC)',
      stddev: 'sample standard deviation (n - 1); 0 when n = 1',
      warmup: 'samples with warmup:true are kept in the raw data and excluded from every statistic',
      units: {
        Ms: 'milliseconds',
        Bytes: 'bytes',
        MiBps: 'MiB (1,048,576 bytes) per second',
        parallelism: 'jobs running at once, on average',
      },
      durations: 'backup and restore durations come from job timestamps (completedAt - startedAt), not from polling',
    },
    cases: input.cases,
  };
}

// ── summary.md ──────────────────────────────────────────────────

const ENGINE_TITLE: Record<string, string> = { postgres: 'PostgreSQL', mysql: 'MySQL' };
const engineTitle = (record: CaseRecord): string =>
  ENGINE_TITLE[String(record.labels.engine)] ?? String(record.labels.engine);

/** Right-aligns every column after the first `textColumns`. */
function table(headers: string[], rows: string[][], textColumns = 1): string {
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  const align = headers.map((_, index) => (index < textColumns ? ':---' : '---:'));
  return [line(headers), `|${align.join('|')}|`, ...rows.map(line)].join('\n');
}

const fixed = (value: number, digits: number): string => value.toFixed(digits);

/** `n | min | p50 | p95 | max | mean | σ`, scaled and fixed to `digits` decimals. */
function statCells(s: Summary, scale: number, digits: number): string[] {
  return [
    String(s.n),
    ...[s.min, s.p50, s.p95, s.max, s.mean, s.stddev].map((value) => fixed(value / scale, digits)),
  ];
}

const STAT_HEADERS = ['n', 'min', 'p50', 'p95', 'max', 'mean', 'σ'];

/** The `*` that marks a case which stopped before its last repetition. */
const flag = (record: CaseRecord, text: string): string => (record.complete ? text : `${text}*`);

function ofGroup(cases: readonly CaseStats[], group: Group): CaseStats[] {
  return cases.filter((record) => record.group === group);
}

function throughputTable(
  title: string,
  cases: readonly CaseStats[],
  metric: string,
  scale: number,
  digits: number,
): string[] {
  const rows = cases
    .filter((record) => record.stats[metric])
    .map((record) => [
      engineTitle(record),
      flag(record, String(record.labels.size)),
      ...statCells(record.stats[metric], scale, digits),
    ]);
  return rows.length === 0 ? [] : [`### ${title}`, '', table(['Engine', 'Size', ...STAT_HEADERS], rows, 2), ''];
}

function datasetsSection(cases: readonly CaseStats[]): string[] {
  const rows = cases
    .filter((record) => record.meta.dataset)
    .map((record) => {
      const dataset = record.meta.dataset as DatasetInfo;
      const dump = record.stats['backup.dumpBytes']?.p50;
      return [
        engineTitle(record),
        flag(record, String(record.labels.size)),
        String(dataset.targetMiB),
        fixed(toMiB(dataset.sourceBytes), 1),
        fixed(toMiB(dataset.indexBytes), 1),
        dump === undefined ? '-' : fixed(toMiB(dump), 1),
        dump === undefined ? '-' : fixed(dump / dataset.sourceBytes, 2),
        dataset.customers.toLocaleString('en-US'),
        dataset.orders.toLocaleString('en-US'),
        dataset.events.toLocaleString('en-US'),
        fixed(dataset.seedMs / 1000, 1),
      ];
    });
  if (rows.length === 0) {
    return [];
  }
  return [
    '## Datasets',
    '',
    'Generated inside each database server, once per engine and size (never timed). ' +
      'Source size is tables plus indexes as the server reports them.',
    '',
    table(
      [
        'Engine', 'Size', 'Target (MiB)', 'Source (MiB)', 'of which indexes (MiB)', 'Dump p50 (MiB)',
        'Dump / source', 'Customers', 'Orders', 'Events', 'Seed time (s)',
      ],
      rows,
      2,
    ),
    '',
  ];
}

function throughputSections(cases: readonly CaseStats[]): string[] {
  const group = ofGroup(cases, 'throughput');
  if (group.length === 0) {
    return [];
  }
  return [
    ...datasetsSection(group),
    '## Backup',
    '',
    'One backup of the prod connection per repetition, one at a time. Duration is `completedAt - startedAt` of ' +
      'the job; queue wait is `startedAt - createdAt`; wall time is what the test observed from its request to ' +
      'the moment it saw the job completed (it includes polling every 250 ms).',
    '',
    ...throughputTable('Backup duration (s)', group, 'backup.durationMs', 1000, 2),
    ...throughputTable('Backup queue wait (ms)', group, 'backup.queueWaitMs', 1, 0),
    ...throughputTable('Backup wall time (s)', group, 'backup.wallMs', 1000, 2),
    ...throughputTable('Backup throughput, source bytes (MiB/s)', group, 'backup.sourceMiBps', 1, 1),
    ...throughputTable('Backup throughput, dump bytes (MiB/s)', group, 'backup.dumpMiBps', 1, 1),
    '## Restore',
    '',
    'Each backup is restored into a fresh, empty `dev` database, then the row count of every table is compared ' +
      'with the source. As for a backup, queue wait is `startedAt - createdAt` (the worker overwrites the ' +
      '`startedAt` of the admission when it takes the job) and duration is `completedAt - startedAt`: download ' +
      'from storage, staging and load.',
    '',
    ...throughputTable('Restore queue wait (ms)', group, 'restore.queueWaitMs', 1, 0),
    ...throughputTable('Restore duration (s)', group, 'restore.durationMs', 1000, 2),
    ...throughputTable('Restore wall time (s)', group, 'restore.wallMs', 1000, 2),
    ...throughputTable('Restore throughput, source bytes (MiB/s)', group, 'restore.sourceMiBps', 1, 1),
    ...throughputTable('Restore throughput, dump bytes (MiB/s)', group, 'restore.dumpMiBps', 1, 1),
  ];
}

const seconds = (s: Summary | undefined, pick: keyof Summary = 'p50'): string =>
  s ? fixed((s[pick] as number) / 1000, 2) : '-';

function queueSections(cases: readonly CaseStats[]): string[] {
  const backups = ofGroup(cases, 'queue-backup');
  const restores = ofGroup(cases, 'queue-restore');
  if (backups.length === 0 && restores.length === 0) {
    return [];
  }
  const lines = [
    '## BullMQ concurrency',
    '',
    'K backups of K different connections are launched together; the `backup` queue runs 2 at a time and the ' +
      '`restore` queue 1. Every figure is a median over the repetitions unless the header says otherwise.',
    '',
  ];

  if (backups.length > 0) {
    const rows = backups.map((record) => [
      engineTitle(record),
      flag(record, String(record.labels.jobs)),
      String(record.stats.makespanMs?.n ?? 0),
      seconds(record.stats.makespanMs),
      seconds(record.stats.makespanMs, 'p95'),
      seconds(record.stats.queueWaitMeanMs),
      seconds(record.stats.queueWaitMaxMs),
      seconds(record.stats.durationMeanMs),
      record.stats.parallelism ? fixed(record.stats.parallelism.p50, 2) : '-',
    ]);
    const rankOf = (name: string): number => Number(/^rank(\d+)\.queueWaitMs$/.exec(name)?.[1] ?? 0);
    const ranks = Math.max(0, ...backups.flatMap((record) => Object.keys(record.stats).map(rankOf)));
    const stairs = backups.map((record) => [
      engineTitle(record),
      flag(record, String(record.labels.jobs)),
      ...Array.from({ length: ranks }, (_, index) => seconds(record.stats[`rank${index + 1}.queueWaitMs`])),
    ]);
    lines.push(
      '### Simultaneous backups',
      '',
      table(
        [
          'Engine', 'Jobs (K)', 'n', 'Makespan p50 (s)', 'Makespan p95 (s)', 'Queue wait, mean of K (s)',
          'Queue wait, longest (s)', 'Duration, mean of K (s)', 'Parallelism',
        ],
        rows,
        2,
      ),
      '',
      '### Queue wait by start order (s, median)',
      '',
      table(['Engine', 'Jobs (K)', ...Array.from({ length: ranks }, (_, index) => `#${index + 1}`)], stairs, 2),
      '',
    );
  }

  if (restores.length > 0) {
    const rows = restores.map((record) => [
      engineTitle(record),
      flag(record, String(record.labels.jobs)),
      String(record.stats.makespanMs?.n ?? 0),
      seconds(record.stats.makespanMs),
      seconds(record.stats.makespanMs, 'p95'),
      seconds(record.stats.queueWaitMaxMs),
      seconds(record.stats['done1.durationMs']),
      seconds(record.stats['done2.durationMs']),
      seconds(record.stats.completionGapMs),
    ]);
    lines.push(
      '### Simultaneous restores',
      '',
      table(
        [
          'Engine', 'Jobs (R)', 'n', 'Makespan p50 (s)', 'Makespan p95 (s)', 'Queue wait, longest (s)',
          'First to finish: duration (s)', 'Second to finish: duration (s)', 'Gap between completions (s)',
        ],
        rows,
        2,
      ),
      '',
    );
  }
  return lines;
}

function frontendSections(cases: readonly CaseStats[]): string[] {
  const group = ofGroup(cases, 'frontend');
  if (group.length === 0) {
    return [];
  }
  const pair = (record: CaseStats, metric: string, scale = 1, digits = 0): string[] =>
    record.stats[metric]
      ? [fixed(record.stats[metric].p50 / scale, digits), fixed(record.stats[metric].p95 / scale, digits)]
      : ['-', '-'];
  const timing = group.map((record) => [
    flag(record, String(record.labels.page)),
    String(record.labels.viewport),
    String(record.stats.loadMs?.n ?? 0),
    ...pair(record, 'ttfbMs'),
    ...pair(record, 'domContentLoadedMs'),
    ...pair(record, 'loadMs'),
  ]);
  const paint = group.map((record) => [
    flag(record, String(record.labels.page)),
    String(record.labels.viewport),
    ...pair(record, 'fcpMs'),
    ...pair(record, 'lcpMs'),
    ...pair(record, 'transferBytes', 1024, 0),
    ...pair(record, 'requestsCount'),
  ]);
  return [
    '## Front-end (Chromium)',
    '',
    'Cold loads: a fresh browser context for every load, so the cache is empty. ' +
      'Medians and 95th percentiles over the loads.',
    '',
    '### Navigation Timing (ms)',
    '',
    table(
      [
        'Page', 'Viewport', 'n', 'TTFB p50', 'TTFB p95', 'DOMContentLoaded p50', 'DOMContentLoaded p95',
        'Load p50', 'Load p95',
      ],
      timing,
      2,
    ),
    '',
    '### Paint and weight',
    '',
    table(
      [
        'Page', 'Viewport', 'FCP p50 (ms)', 'FCP p95 (ms)', 'LCP p50 (ms)', 'LCP p95 (ms)',
        'Transfer p50 (KiB)', 'Transfer p95 (KiB)', 'Requests p50', 'Requests p95',
      ],
      paint,
      2,
    ),
    '',
  ];
}

function apiSections(cases: readonly CaseStats[]): string[] {
  const group = ofGroup(cases, 'api');
  if (group.length === 0) {
    return [];
  }
  const rows = group
    .filter((record) => record.stats.latencyMs)
    .map((record) => {
      const s = record.stats.latencyMs;
      return [
        flag(record, `\`${record.labels.endpoint}\``),
        String(s.n),
        ...[s.min, s.p50, s.p95, s.p99, s.max, s.mean, s.stddev].map((value) => fixed(value, 1)),
        record.stats.responseBytes ? fixed(record.stats.responseBytes.p50, 0) : '-',
        record.meta.rows === undefined ? '-' : String(record.meta.rows),
      ];
    });
  return [
    '## API latency',
    '',
    'Sequential requests through the web proxy (`:5173/api`) with the saved admin session, one at a time. ' +
      'Latency is measured by the client from sending the request to having read the whole body.',
    '',
    table(
      [
        'Endpoint', 'n', 'min (ms)', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'max (ms)', 'mean (ms)', 'σ (ms)',
        'Response p50 (B)', 'Rows',
      ],
      rows,
      1,
    ),
    '',
  ];
}

function environmentSection(environment: EnvironmentInfo, config: PerfConfig, cases: readonly CaseStats[]): string[] {
  const metaOf = (key: string, engine?: string): string | undefined =>
    cases.find((record) => record.meta[key] !== undefined && (engine === undefined || record.labels.engine === engine))
      ?.meta[key] as string | undefined;
  const { host, docker: vm, git } = environment;
  const commit = git.sha && `\`${git.sha.slice(0, 10)}\`${git.dirty ? ' (uncommitted changes)' : ''}`;
  const items: [string, string | undefined][] = [
    ['Run', `\`${environment.runId}\` (preset \`${config.preset}\`)`],
    ['Date (UTC)', environment.generatedAt],
    ['Commit', commit],
    ['Test host', `${host.os} ${host.arch}, ${host.cpus} × ${host.cpuModel}, ${host.memoryGiB} GiB`],
    ['Docker VM', vm && `${vm.cpus ?? '?'} CPUs, ${vm.memoryGiB ?? '?'} GiB, Docker ${vm.serverVersion ?? '?'}`],
    ['Node.js / Playwright', `${environment.node} / ${environment.playwright ?? 'unknown'}`],
    ['Chromium', metaOf('browserVersion')],
    ['Source PostgreSQL', metaOf('serverVersion', 'postgres')],
    ['Source MySQL', metaOf('serverVersion', 'mysql')],
    ['pg_dump (API image)', environment.tools.pgDump],
    ['mysqldump (API image)', environment.tools.mysqldump],
    ['Object storage', 'MinIO on the same Docker VM (not Cloudflare R2)'],
  ];
  return [
    '## Environment',
    '',
    table(['Item', 'Value'], items.filter((item): item is [string, string] => item[1] !== undefined), 2),
    '',
  ];
}

const NOTES = [
  '- p50 is the median. p95 and p99 use linear interpolation between closest ranks (R-7). With fewer than 20 ' +
    'samples p95 lies between the two largest values, so read it as "close to the maximum"; it is kept so every ' +
    'table has the same shape.',
  '- σ is the sample standard deviation (n - 1). The first repetition of each case is a discarded warm-up: it is ' +
    'in `results.json` flagged `warmup: true` and in no statistic.',
  '- Sizes are MiB (1,048,576 bytes). Throughput is bytes divided by the job duration, for the source size and ' +
    'for the dump size; for a restore the dump size is what is read back from storage.',
  '- Timings belong to this machine and to MinIO on the local Docker network. They say nothing about ' +
    'Cloudflare R2, whose network hop is not in them.',
  '- A `*` marks a case that did not reach its last repetition; its statistics cover what was measured before ' +
    'it stopped.',
];

export function buildMarkdown(input: {
  environment: EnvironmentInfo;
  config: PerfConfig;
  cases: readonly CaseStats[];
}): string {
  const { environment, config, cases } = input;
  return (
    [
      '# Performance results',
      '',
      ...environmentSection(environment, config, cases),
      ...throughputSections(cases),
      ...queueSections(cases),
      ...frontendSections(cases),
      ...apiSections(cases),
      '## Notes',
      '',
      ...NOTES,
    ].join('\n') + '\n'
  );
}
