import { caseTimeoutMs, jobTimeoutMs, readPerfConfig, TARGET_MIB } from '../../support/perf/config';
import { countRows, seedDataset } from '../../support/perf/datasets';
import {
  backupTimings,
  queueBackupMetrics,
  queueRestoreMetrics,
  restoreTimings,
} from '../../support/perf/measure';
import { CaseRecorder } from '../../support/perf/results';
import { discardTarget, progress, removeDumps, timed, timedBackup } from '../../support/perf/runs';
import { formatDuration } from '../../support/perf/stats';
import type { Connection } from '../../support/fixtures';
import { expect, test, type TestDatabase } from '../../support/pipeline-fixtures';

// How the BullMQ queues behave under simultaneous requests. The `backup` queue
// runs 2 jobs at a time and the `restore` queue 1, so K backups launched
// together should finish in waves: jobs 1 and 2 start at once, job 3 waits for
// one of them to end, and so on. The waits and the makespan (first request to
// last completion) show it as a staircase.
//
// The K backups are of K different connections, because the API defers a second
// backup of the same connection with a 30-300 s backoff. The connections are
// K records pointing at one source database: the queue and the per-connection
// lease only see connection ids, and a single source keeps the load identical
// and avoids generating K copies of the dataset.

const perf = readPerfConfig();
const { size, backupConcurrencies, restoreConcurrencies, runs } = perf.queue;

const ENGINE_TITLE = { postgres: 'PostgreSQL', mysql: 'MySQL' } as const;

for (const dbType of perf.engines) {
  test(`${ENGINE_TITLE[dbType]}: simultaneous backups and restores (${size} dataset, about ${TARGET_MIB[size]} MiB)`, async ({
    newDatabase,
    createConnection,
    restoreTarget,
    jobs,
    adminApi,
  }) => {
    test.setTimeout(caseTimeoutMs(size, runs * (backupConcurrencies.length + restoreConcurrencies.length)));
    // Jobs run in waves (2 backups at a time, 1 restore), and each wave may take one job's deadline.
    const backupWaitMs = (jobCount: number): number => jobTimeoutMs(size) * Math.ceil(jobCount / 2);
    const restoreWaitMs = (jobCount: number): number => jobTimeoutMs(size) * jobCount;

    const source = await newDatabase(dbType, 'empty');
    const dataset = await seedDataset(dbType, source.name, size);
    const serverVersion = await source.engine.serverVersion();
    const meta = { dataset, serverVersion };

    const connections: Connection[] = [];
    for (let index = 0; index < Math.max(...backupConcurrencies); index++) {
      connections.push((await createConnection({ ...source.settings, environment: 'prod' })).connection);
    }

    // ── Backups: K at once ────────────────────────────────────────
    for (const jobCount of backupConcurrencies) {
      const label = `${dbType}/K=${jobCount}`;
      const recorder = new CaseRecorder({
        group: 'queue-backup',
        id: label,
        labels: { engine: dbType, jobs: jobCount },
        meta,
      });

      for (let run = 0; run <= runs; run++) {
        const { result: finished, wallMs } = await timed(async () => {
          const started = await Promise.all(
            connections.slice(0, jobCount).map((connection) => jobs.startBackup(connection.id)),
          );
          return Promise.all(started.map(({ jobId }) => jobs.waitForBackup(jobId, { timeoutMs: backupWaitMs(jobCount) })));
        });

        const timings = finished.map(backupTimings);
        const metrics = queueBackupMetrics(timings);
        recorder.add({
          run,
          warmup: run === 0,
          metrics: { ...metrics, wallMs },
          details: { jobs: timings },
        });
        progress(
          `${label} ${run === 0 ? 'warm-up' : `run ${run}/${runs}`}: ` +
            `makespan ${formatDuration(metrics.makespanMs)}, ` +
            `longest queue wait ${formatDuration(metrics.queueWaitMaxMs)}, ` +
            `parallelism ${metrics.parallelism.toFixed(2)}`,
        );
        await removeDumps(finished);
      }
      recorder.finish();
    }

    // ── Restores: R at once, from one backup ───────────────────────
    const backup = await timedBackup(jobs, connections[0].id, backupWaitMs(1));
    for (const jobCount of restoreConcurrencies) {
      const label = `${dbType}/R=${jobCount}`;
      const recorder = new CaseRecorder({
        group: 'queue-restore',
        id: label,
        labels: { engine: dbType, jobs: jobCount },
        meta,
      });

      for (let run = 0; run <= runs; run++) {
        // Targets are made before the clock starts.
        const targets: { database: TestDatabase; connection: Connection }[] = [];
        for (let index = 0; index < jobCount; index++) {
          targets.push(await restoreTarget(dbType, 'dev'));
        }

        const { result: finished, wallMs } = await timed(async () => {
          const started = await Promise.all(
            targets.map((target) =>
              jobs.startRestore({ sourceBackupId: backup.job.id, targetConnectionId: target.connection.id }),
            ),
          );
          return Promise.all(started.map(({ jobId }) => jobs.waitForRestore(jobId, { timeoutMs: restoreWaitMs(jobCount) })));
        });
        for (const target of targets) {
          expect(await countRows(dbType, target.database.name), 'rows restored into the target').toEqual(
            dataset.rows,
          );
        }

        const metrics = queueRestoreMetrics(finished.map(restoreTimings));
        recorder.add({ run, warmup: run === 0, metrics: { ...metrics, wallMs }, details: { jobs: finished.map(restoreTimings) } });
        progress(
          `${label} ${run === 0 ? 'warm-up' : `run ${run}/${runs}`}: makespan ${formatDuration(metrics.makespanMs)}` +
            (metrics.completionGapMs === undefined ? '' : `, gap between completions ${formatDuration(metrics.completionGapMs)}`),
        );
        for (const target of targets) {
          await discardTarget(adminApi, target);
        }
      }
      recorder.finish();
    }
    await removeDumps([backup.job]);
  });
}
