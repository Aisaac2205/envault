import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { RUN_ID_VARIABLE } from './results';

/**
 * What a run needs to be read later: which code, on which machine, against
 * which tool versions. Everything is optional because it is gathered on a
 * best-effort basis from tools that happen to be installed (`git`, `docker`);
 * a value that cannot be read is left out, never guessed.
 */

const run = promisify(execFile);

const REPOSITORY = path.resolve(__dirname, '..', '..', '..');
const COMPOSE_PROJECT = 'envault-e2e';

async function read(command: string, args: string[], cwd?: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(command, args, { cwd, timeout: 15_000, windowsHide: true });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface EnvironmentInfo {
  runId: string;
  generatedAt: string;
  git: { sha?: string; dirty?: boolean };
  node: string;
  playwright?: string;
  /** The machine that runs the tests and the browser. */
  host: { os: string; arch: string; cpus: number; cpuModel: string; memoryGiB: number };
  /** The VM that runs the containers, as `docker info` reports it. */
  docker?: { serverVersion?: string; cpus?: number; memoryGiB?: number; os?: string };
  /** Dump tools inside the API image, which is what a backup and a restore really use. */
  tools: { pgDump?: string; mysqldump?: string; mysql?: string };
  /** The `E2E_*` variables in effect: the knobs of the run and the stack's image and port overrides. */
  variables: Record<string, string>;
}

export async function collectEnvironment(runId: string): Promise<EnvironmentInfo> {
  const [sha, status, dockerInfo, apiContainer] = await Promise.all([
    read('git', ['rev-parse', 'HEAD'], REPOSITORY),
    read('git', ['status', '--porcelain'], REPOSITORY),
    read('docker', ['info', '--format', '{{.NCPU}}|{{.MemTotal}}|{{.ServerVersion}}|{{.OperatingSystem}}']),
    read('docker', [
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${COMPOSE_PROJECT}`,
      '--filter',
      'label=com.docker.compose.service=api',
    ]),
  ]);

  const [cpus, memory, serverVersion, dockerOs] = dockerInfo?.split('|') ?? [];
  const inApi = (command: string): Promise<string | undefined> =>
    apiContainer ? read('docker', ['exec', apiContainer.split('\n')[0], command, '--version']) : Promise.resolve(undefined);
  const [pgDump, mysqldump, mysql] = await Promise.all([inApi('pg_dump'), inApi('mysqldump'), inApi('mysql')]);

  const processors = os.cpus();
  return {
    runId,
    generatedAt: new Date().toISOString(),
    git: { sha, dirty: status === undefined ? undefined : status.length > 0 },
    node: process.version,
    playwright: playwrightVersion(),
    host: {
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpus: processors.length,
      cpuModel: processors[0]?.model.trim() ?? 'unknown',
      memoryGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    },
    docker: dockerInfo
      ? {
          serverVersion,
          cpus: Number(cpus) || undefined,
          memoryGiB: Number(memory) ? Math.round((Number(memory) / 1024 ** 3) * 10) / 10 : undefined,
          os: dockerOs,
        }
      : undefined,
    tools: { pgDump, mysqldump, mysql },
    variables: Object.fromEntries(
      Object.entries(process.env)
        .filter(([name, value]) => name.startsWith('E2E_') && name !== RUN_ID_VARIABLE && value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)) as [string, string][],
    ),
  };
}

function playwrightVersion(): string | undefined {
  try {
    return (require('@playwright/test/package.json') as { version: string }).version;
  } catch {
    return undefined;
  }
}
