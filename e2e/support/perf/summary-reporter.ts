import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter } from '@playwright/test/reporter';
import { readPerfConfig } from './config';
import { collectEnvironment } from './environment';
import { aggregate, buildCsv, buildMarkdown, buildResults } from './report';
import { readCases, removeFragments, RUN_ID_VARIABLE, runDirectory } from './results';

/**
 * Playwright reporter of the performance config. When the run ends, whether it
 * passed or not, it merges the cases the specs recorded into
 * `e2e/perf-results/<run id>/{results.json,summary.csv,summary.md}`. A run that
 * recorded nothing (the unit tests alone, `--list`) writes nothing.
 */
export default class SummaryReporter implements Reporter {
  printsToStdio(): boolean {
    return false;
  }

  async onEnd(_result: FullResult): Promise<void> {
    const directory = runDirectory();
    try {
      const records = readCases(directory);
      if (records.length === 0) {
        return;
      }

      const cases = aggregate(records);
      const input = {
        environment: await collectEnvironment(process.env[RUN_ID_VARIABLE] ?? path.basename(directory)),
        config: readPerfConfig(),
        cases,
      };

      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'results.json'), JSON.stringify(buildResults(input), null, 2) + '\n');
      writeFileSync(path.join(directory, 'summary.csv'), buildCsv(cases));
      writeFileSync(path.join(directory, 'summary.md'), buildMarkdown(input));
      removeFragments(directory);

      console.log(`\nPerformance results: ${directory}`);
    } catch (error) {
      // The raw fragments stay on disk when this fails, so nothing measured is lost.
      console.error(`\nCould not write the performance summary (raw cases kept in ${directory}): ${String(error)}`);
    }
  }
}
