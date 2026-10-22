import type { DbType } from '../databases';

/**
 * What the performance suite measures and how many times, read from the
 * environment so a run can be shortened or widened without editing code. The
 * defaults are the "full" preset; `E2E_PERF_PRESET=quick` is a smoke check of
 * the whole harness. Any individual variable wins over the preset.
 *
 * Parsing is a pure function of the environment (see `parsePerfConfig`), so the
 * rules are unit-tested without the stack.
 */

export const ENGINE_NAMES = ['postgres', 'mysql'] as const satisfies readonly DbType[];

/** Dataset sizes, smallest first. `xlarge` is about 1 GB and never part of the defaults. */
export const SIZE_NAMES = ['small', 'medium', 'large', 'xlarge'] as const;
export type SizeName = (typeof SIZE_NAMES)[number];

/** The logical size each dataset aims for, in MiB (1 MiB = 1,048,576 bytes). */
export const TARGET_MIB: Record<SizeName, number> = {
  small: 10,
  medium: 100,
  large: 500,
  xlarge: 1024,
};

export interface PerfConfig {
  preset: 'full' | 'quick';
  engines: DbType[];
  sizes: SizeName[];
  /** Measured repetitions per case, without the discarded warm-up. */
  runs: Record<SizeName, number>;
  queue: {
    /** Dataset the simultaneous backups and restores work on. */
    size: SizeName;
    /** How many backups are launched at once, one value per case. */
    backupConcurrencies: number[];
    /** How many restores are launched at once, one value per case. */
    restoreConcurrencies: number[];
    /** Measured repetitions per case, without the discarded warm-up. */
    runs: number;
  };
  frontend: {
    /** Cold loads per page, without the discarded warm-up. */
    loads: number;
    /** Cold loads of the login page at a viewport wide enough for the WebGL panel. */
    wideLoads: number;
  };
  api: {
    /** Sequential requests per endpoint, without the discarded warm-ups. */
    requests: number;
    warmups: number;
  };
}

const FULL: PerfConfig = {
  preset: 'full',
  engines: [...ENGINE_NAMES],
  sizes: ['small', 'medium', 'large'],
  runs: { small: 20, medium: 20, large: 10, xlarge: 3 },
  queue: {
    size: 'medium',
    backupConcurrencies: [1, 2, 4, 6],
    restoreConcurrencies: [1, 2],
    runs: 5,
  },
  frontend: { loads: 20, wideLoads: 10 },
  api: { requests: 100, warmups: 5 },
};

const QUICK: PerfConfig = {
  preset: 'quick',
  engines: [...ENGINE_NAMES],
  sizes: ['small'],
  runs: { small: 2, medium: 2, large: 2, xlarge: 2 },
  queue: {
    size: 'small',
    backupConcurrencies: [1, 2, 4],
    restoreConcurrencies: [1, 2],
    runs: 1,
  },
  frontend: { loads: 3, wideLoads: 2 },
  api: { requests: 20, warmups: 2 },
};

const PRESETS = { full: FULL, quick: QUICK } as const;

/** Largest K accepted for simultaneous backups: more would only queue behind the same two slots. */
const MAX_CONCURRENCY = 12;

function parseList<T extends string>(raw: string, allowed: readonly T[], name: string): T[] {
  const items = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unknown = items.filter((item) => !allowed.includes(item as T));
  if (items.length === 0 || unknown.length > 0) {
    throw new Error(
      `${name}="${raw}" is not valid${unknown.length ? ` (unknown: ${unknown.join(', ')})` : ''}. ` +
        `Use a comma-separated list of: ${allowed.join(', ')}.`,
    );
  }
  return [...new Set(items)] as T[];
}

function parseInteger(raw: string, name: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}="${raw}" is not valid: use a whole number from ${min} to ${max}.`);
  }
  return value;
}

function parseConcurrencies(raw: string, name: string): number[] {
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseInteger(item, name, 1, MAX_CONCURRENCY));
  if (values.length === 0) {
    throw new Error(`${name}="${raw}" is not valid: list at least one number, for example 1,2,4,6.`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

/** The settings for an environment. Unset or empty variables fall back to the preset. */
export function parsePerfConfig(env: NodeJS.ProcessEnv): PerfConfig {
  const read = (name: string): string | undefined => env[name]?.trim() || undefined;

  const presetName = (read('E2E_PERF_PRESET') ?? 'full').toLowerCase();
  if (presetName !== 'full' && presetName !== 'quick') {
    throw new Error(`E2E_PERF_PRESET="${presetName}" is not valid: use "full" or "quick".`);
  }
  const preset = PRESETS[presetName];

  const config: PerfConfig = structuredClone(preset);

  const engines = read('E2E_PERF_ENGINES');
  if (engines) {
    config.engines = parseList(engines, ENGINE_NAMES, 'E2E_PERF_ENGINES');
  }
  const sizes = read('E2E_PERF_SIZES');
  if (sizes) {
    config.sizes = parseList(sizes, SIZE_NAMES, 'E2E_PERF_SIZES');
  }
  const runs = read('E2E_PERF_RUNS');
  if (runs) {
    const count = parseInteger(runs, 'E2E_PERF_RUNS', 1, 100);
    config.runs = { small: count, medium: count, large: count, xlarge: count };
  }
  const queueSize = read('E2E_PERF_QUEUE_SIZE');
  if (queueSize) {
    config.queue.size = parseList(queueSize, SIZE_NAMES, 'E2E_PERF_QUEUE_SIZE')[0];
  }
  const queueBackups = read('E2E_PERF_QUEUE_K');
  if (queueBackups) {
    config.queue.backupConcurrencies = parseConcurrencies(queueBackups, 'E2E_PERF_QUEUE_K');
  }
  const queueRestores = read('E2E_PERF_QUEUE_RESTORES');
  if (queueRestores) {
    config.queue.restoreConcurrencies = parseConcurrencies(queueRestores, 'E2E_PERF_QUEUE_RESTORES');
  }
  const queueRuns = read('E2E_PERF_QUEUE_RUNS');
  if (queueRuns) {
    config.queue.runs = parseInteger(queueRuns, 'E2E_PERF_QUEUE_RUNS', 1, 100);
  }
  const loads = read('E2E_PERF_UI_RUNS');
  if (loads) {
    config.frontend.loads = parseInteger(loads, 'E2E_PERF_UI_RUNS', 1, 200);
    config.frontend.wideLoads = Math.min(config.frontend.wideLoads, config.frontend.loads);
  }
  const requests = read('E2E_PERF_API_REQUESTS');
  if (requests) {
    config.api.requests = parseInteger(requests, 'E2E_PERF_API_REQUESTS', 1, 2000);
  }

  return config;
}

export const readPerfConfig = (): PerfConfig => parsePerfConfig(process.env);

// ── Deadlines ───────────────────────────────────────────────────
//
// They only bound a hang: a healthy run finishes far inside them. They scale
// with the dataset because the API itself allows a dump 30 minutes by default.

/** How long one backup or restore job may take before the harness gives up on it. */
export const jobTimeoutMs = (size: SizeName): number => 60_000 + TARGET_MIB[size] * 1_500;

/** How long the generation of one dataset may take. */
export const seedTimeoutMs = (size: SizeName): number => 120_000 + TARGET_MIB[size] * 2_000;

/** Playwright's timeout for one case: seeding, then the warm-up and every repetition. */
export function caseTimeoutMs(size: SizeName, runs: number): number {
  const repetition = 2 * jobTimeoutMs(size) + 60_000;
  return seedTimeoutMs(size) + (runs + 1) * repetition + 60_000;
}
