import { setTimeout as sleep } from 'node:timers/promises';
import { DIRECT_API_URL } from './env';

/** How long to wait for a stack that is still booting before giving up. */
export const STACK_READY_TIMEOUT_MS = 30_000;

const POLL_INTERVAL_MS = 1_000;
const ATTEMPT_TIMEOUT_MS = 2_000;

/**
 * Polls the API health endpoint until the stack answers 200, or fails with a
 * message that says how to start it. `pnpm docker:e2e` already waits for the
 * containers to be healthy, so this only absorbs the gap between "started" and
 * "ready" and turns a connection error into an actionable failure.
 */
export async function waitForStack(): Promise<void> {
  const healthUrl = `${DIRECT_API_URL}/health`;
  const deadline = Date.now() + STACK_READY_TIMEOUT_MS;
  let lastResult = 'no attempt was made';

  do {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (response.ok) {
        return;
      }
      lastResult = `HTTP ${response.status}`;
    } catch (error) {
      lastResult = describeNetworkError(error);
    }
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new Error(
    `The E2E stack is not ready: GET ${healthUrl} did not return 200 within ` +
      `${STACK_READY_TIMEOUT_MS / 1000} s (last result: ${lastResult}). ` +
      'Start it with `pnpm docker:e2e` (it needs .env.e2e, see .env.e2e.example) ' +
      'and run the tests again.',
  );
}

function describeNetworkError(error: unknown): string {
  // fetch wraps the socket error: "fetch failed" with the real code in `cause`.
  const cause = error instanceof Error ? error.cause : undefined;
  const code = (cause as NodeJS.ErrnoException | undefined)?.code;
  return code ?? (error instanceof Error ? error.message : String(error));
}
