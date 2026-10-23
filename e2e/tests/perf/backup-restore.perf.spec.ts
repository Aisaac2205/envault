import { caseTimeoutMs, jobTimeoutMs, readPerfConfig, TARGET_MIB } from '../../support/perf/config';
import { countRows, seedDataset } from '../../support/perf/datasets';
import { backupTimings, restoreTimings, throughputMetrics } from '../../support/perf/measure';
import { CaseRecorder } from '../../support/perf/results';
import { discardTarget, progress, removeDumps, timedBackup, timedRestore } from '../../support/perf/runs';
import { formatBytes, formatDuration, throughputMiBps } from '../../support/perf/stats';
import { expect, test } from '../../support/pipeline-fixtures';

// Dump and restore throughput per engine and dataset size, through the real
// pipeline: API, BullMQ, pg_dump / mysqldump in the API container, MinIO, then
// pg_restore / mysql into a fresh database.
//
// A case is one engine and one size. Its dataset is generated once and every
// repetition backs up that same source, one backup at a time (the one run that
// is alone on the stack is the point). Run 0 is a warm-up that is recorded and
// left out of the statistics: the first dump of a freshly loaded database pays
// for caches and for the connection to the object store. The proof that a
// restore worked is cheap and exact: every table of the target has as many rows
// as the source.

const perf = readPerfConfig();

const ENGINE_TITLE = { postgres: 'PostgreSQL', mysql: 'MySQL' } as const;

for (const dbType of perf.engines) {
  test.describe(`${ENGINE_TITLE[dbType]} dump and restore`, () => {
    for (const size of perf.sizes) {
      const runs = perf.runs[size];

      test(`${size} dataset (about ${TARGET_MIB[size]} MiB), ${runs} runs`, async ({
        newDatabase,
        createConnection,
        restoreTarget,
        jobs,
        adminApi,
      }) => {
        test.setTimeout(caseTimeoutMs(size, runs));
        const timeoutMs = jobTimeoutMs(size);
        const label = `${dbType}/${size}`;

        const source = await newDatabase(dbType, 'empty');
        const dataset = await seedDataset(dbType, source.name, size);
        progress(
          `${label}: generated ${formatBytes(dataset.sourceBytes)} ` +
            `(${dataset.events.toLocaleString('en-US')} events) in ${formatDuration(dataset.seedMs)}`,
        );
        const { connection } = await createConnection({ ...source.settings, environment: 'prod' });

        const recorder = new CaseRecorder({
          group: 'throughput',
          id: label,
          labels: { engine: dbType, size },
          meta: { dataset, serverVersion: await source.engine.serverVersion() },
        });

        for (let run = 0; run <= runs; run++) {
          const backup = await timedBackup(jobs, connection.id, timeoutMs);
          expect(backup.job.bytes, 'size of the dump').toBeGreaterThan(0);

          // The target and its connection are made before the clock starts.
          const target = await restoreTarget(dbType, 'dev');
          const restore = await timedRestore(
            jobs,
            { sourceBackupId: backup.job.id, targetConnectionId: target.connection.id },
            timeoutMs,
          );
          expect(await countRows(dbType, target.database.name), 'rows restored into the target').toEqual(
            dataset.rows,
          );

          const backupTiming = backupTimings(backup.job);
          const restoreTiming = restoreTimings(restore.job);
          recorder.add({
            run,
            warmup: run === 0,
            metrics: throughputMetrics({
              sourceBytes: dataset.sourceBytes,
              dumpBytes: backup.job.bytes!,
              backup: backupTiming,
              backupWallMs: backup.wallMs,
              restore: restoreTiming,
              restoreWallMs: restore.wallMs,
            }),
            details: { backupJobId: backup.job.id, restoreJobId: restore.job.id, sha256: backup.job.sha256 },
          });
          progress(
            `${label} ${run === 0 ? 'warm-up' : `run ${run}/${runs}`}: ` +
              `backup ${formatDuration(backupTiming.durationMs)} ` +
              `(${throughputMiBps(dataset.sourceBytes, backupTiming.durationMs).toFixed(1)} MiB/s of source, ` +
              `${formatBytes(backup.job.bytes!)} dump), ` +
              `restore ${formatDuration(restoreTiming.durationMs)}`,
          );

          await discardTarget(adminApi, target);
          await removeDumps([backup.job]);
        }
        recorder.finish();
      });
    }
  });
}
