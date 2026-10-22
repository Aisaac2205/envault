import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Where a performance run leaves its raw measurements. Every spec writes the
 * samples of a case to a small JSON file of its own as it goes, so a run that
 * dies half-way keeps what it measured; the reporter (summary-reporter.ts)
 * merges those files into `results.json`, `summary.csv` and `summary.md` when
 * the run ends and removes them.
 *
 * All output of a run lives in `e2e/perf-results/<UTC timestamp>/` (git-ignored).
 * The timestamp is chosen once by the Playwright config and handed to the
 * worker and the reporter through the environment.
 */

export const PERF_RESULTS_DIR = path.resolve(__dirname, '..', '..', 'perf-results');

/** Environment variable that carries the id of the current run to the worker and the reporter. */
export const RUN_ID_VARIABLE = 'E2E_PERF_RUN_ID';

const FRAGMENTS_DIR = 'fragments';

export type Group = 'throughput' | 'queue-backup' | 'queue-restore' | 'frontend' | 'api';

/** One repetition of a case. */
export interface Sample {
  /** 0 for the discarded warm-up, then 1..n. */
  run: number;
  /** Kept in the raw data, left out of every statistic. */
  warmup: boolean;
  /** Numbers the statistics are computed from. The suffix names the unit: `Ms`, `Bytes`, `MiBps`, `Count`. */
  metrics: Record<string, number>;
  /** Anything else worth keeping with the raw data: job ids, per-job timings. */
  details?: Record<string, unknown>;
}

/** Everything measured for one row of the summary: an engine and size, a K, a page, an endpoint. */
export interface CaseRecord {
  group: Group;
  /** Unique within the group, for example `postgres/medium` or `K=4`. */
  id: string;
  /** The columns that tell cases apart in the tables, for example `{ engine, size }`. */
  labels: Record<string, string | number>;
  /** ISO time the case began; the summary lists cases in this order. */
  startedAt: string;
  /** False while samples are still being added, or when the case died before its last repetition. */
  complete: boolean;
  /** What describes the case without being a measurement: dataset, server version, viewport. */
  meta: Record<string, unknown>;
  samples: Sample[];
}

/** `2026-10-13T14-05-33Z`: UTC, sortable, and a valid directory name on every OS. */
export function newRunId(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
}

let fallbackRunId: string | undefined;

/** Directory of the current run; created on the first write, never just by asking for it. */
export function runDirectory(): string {
  const id = process.env[RUN_ID_VARIABLE] || (fallbackRunId ??= newRunId());
  return path.join(PERF_RESULTS_DIR, id);
}

const slug = (value: string): string => value.replace(/[^A-Za-z0-9._=-]+/g, '_');

export class CaseRecorder {
  private readonly record: CaseRecord;
  private readonly file: string;

  constructor(init: Pick<CaseRecord, 'group' | 'id' | 'labels' | 'meta'>, directory = runDirectory()) {
    this.record = { ...init, startedAt: new Date().toISOString(), complete: false, samples: [] };
    this.file = path.join(directory, FRAGMENTS_DIR, `${init.group}__${slug(init.id)}.json`);
    this.flush();
  }

  add(sample: Sample): void {
    this.record.samples.push(sample);
    this.flush();
  }

  /** Adds several samples with a single write. */
  addAll(samples: readonly Sample[]): void {
    this.record.samples.push(...samples);
    this.flush();
  }

  /** Adds to what describes the case, for facts learned only after it began (a server version). */
  describe(meta: Record<string, unknown>): void {
    Object.assign(this.record.meta, meta);
    this.flush();
  }

  finish(): void {
    this.record.complete = true;
    this.flush();
  }

  // Written to a sibling file and renamed, so a reader never sees half a file.
  private flush(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.record, null, 2));
    renameSync(temporary, this.file);
  }
}

/** Every case the run recorded, in the order they began. */
export function readCases(directory = runDirectory()): CaseRecord[] {
  const fragments = path.join(directory, FRAGMENTS_DIR);
  if (!existsSync(fragments)) {
    return [];
  }
  return readdirSync(fragments)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(fragments, name), 'utf8')) as CaseRecord)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function removeFragments(directory = runDirectory()): void {
  rmSync(path.join(directory, FRAGMENTS_DIR), { recursive: true, force: true });
}
