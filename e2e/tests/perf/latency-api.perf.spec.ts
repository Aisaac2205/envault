import { readPerfConfig } from '../../support/perf/config';
import { CaseRecorder, type Sample } from '../../support/perf/results';
import { progress } from '../../support/perf/runs';
import { expect, test } from '../../support/fixtures';

// Latency of a few representative read endpoints, one request at a time through
// the web proxy (`:5173/api`) with the saved admin session. The first requests
// of each endpoint are warm-ups. Nothing here calls `/api/auth/*`: Better Auth
// limits those routes per client IP.
//
// Latency is read on the client, from sending the request to having the whole
// body, so it includes nginx and the loopback hop. The cost of an endpoint grows
// with the rows behind it, and job rows pile up for the life of the stack, so
// the case records how many there were. Files run in name order, so this one
// follows the backup and restore specs on purpose: the endpoints are measured on
// a system whose job tables hold what those specs left, not on an empty one.

const { api } = readPerfConfig();

interface Endpoint {
  path: string;
  /** How many rows the response is made of, to put the latency in context. */
  rows?: (body: { data: unknown }) => number;
}

const ENDPOINTS: Endpoint[] = [
  { path: 'connections', rows: ({ data }) => (data as unknown[]).length },
  { path: 'jobs/summary' },
  { path: 'jobs/analytics/daily?window=7', rows: ({ data }) => (data as { days: unknown[] }).days.length },
  { path: 'backups/history', rows: ({ data }) => (data as { total: number }).total },
];

test('latency of the read endpoints', async ({ adminApi }) => {
  test.setTimeout(60_000 + ENDPOINTS.length * (api.requests + api.warmups) * 2_000);

  for (const endpoint of ENDPOINTS) {
    const samples: Sample[] = [];
    let rows: number | undefined;

    for (let request = 0; request < api.warmups + api.requests; request++) {
      const began = performance.now();
      const response = await adminApi.get(endpoint.path);
      const body = await response.body();
      const latencyMs = performance.now() - began;

      expect(response.status(), `GET /api/${endpoint.path}`).toBe(200);
      if (rows === undefined && endpoint.rows) {
        rows = endpoint.rows(JSON.parse(body.toString('utf8')));
      }
      samples.push({
        run: request < api.warmups ? 0 : request - api.warmups + 1,
        warmup: request < api.warmups,
        metrics: { latencyMs, responseBytes: body.length },
      });
    }

    // Written after the loop so no file I/O sits between two timed requests.
    const recorder = new CaseRecorder({
      group: 'api',
      id: `GET ${endpoint.path}`,
      labels: { endpoint: `GET /api/${endpoint.path}` },
      meta: { rows },
    });
    recorder.addAll(samples);
    recorder.finish();

    const measured = samples.filter((sample) => !sample.warmup).map((sample) => sample.metrics.latencyMs);
    progress(
      `GET /api/${endpoint.path}: ${measured.length} requests, ` +
        `fastest ${Math.min(...measured).toFixed(1)} ms, slowest ${Math.max(...measured).toFixed(1)} ms` +
        (rows === undefined ? '' : `, ${rows} rows`),
    );
  }
});
