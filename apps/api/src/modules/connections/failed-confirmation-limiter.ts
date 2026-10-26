interface FailedConfirmationLimiterOptions {
  maxFailures: number;
  windowMs: number;
  maxKeys: number;
  now?: () => number;
}

interface FailureWindow {
  count: number;
  resetAt: number;
}

export type ConfirmationAttempt =
  | { outcome: 'confirmed' }
  | { outcome: 'refused' }
  | { outcome: 'locked'; retryAfterSeconds: number };

/**
 * Limits failed password confirmations per key (a user id) in a fixed window,
 * for the supported single API replica; a restart forgets them.
 *
 * The checks of one key run one at a time, so the budget is read before each
 * check and only a check that answered "wrong password" is recorded: parallel
 * requests can neither run more checks than the budget nor be refused because
 * other checks are still running. Different keys do not wait for each other.
 *
 * Memory stays bounded: a key's queue is dropped once it drains, and once
 * `maxKeys` users have failures in an open window, users without one are
 * refused (fail closed) until a window ends, so the cap never resets the
 * budget of someone who is guessing.
 */
export class FailedConfirmationLimiter {
  private readonly failures = new Map<string, FailureWindow>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly options: FailedConfirmationLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Users with failures recorded, and users with checks queued or running. */
  get size(): { failures: number; queues: number } {
    return { failures: this.failures.size, queues: this.queues.size };
  }

  /**
   * Runs `check` for `key` once the key's earlier checks have settled, unless
   * its budget is spent. A `check` that throws records nothing.
   */
  attempt(key: string, check: () => Promise<boolean>): Promise<ConfirmationAttempt> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(() => this.attemptInTurn(key, check));
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return result;
  }

  private async attemptInTurn(
    key: string,
    check: () => Promise<boolean>,
  ): Promise<ConfirmationAttempt> {
    const retryAfterSeconds = this.lockedFor(key, this.now());
    if (retryAfterSeconds !== undefined) {
      return { outcome: 'locked', retryAfterSeconds };
    }

    if (await check()) {
      return { outcome: 'confirmed' };
    }
    this.recordFailure(key, this.now());
    return { outcome: 'refused' };
  }

  /** Seconds until `key` may try again, or undefined when it may try now. */
  private lockedFor(key: string, now: number): number | undefined {
    const current = this.failures.get(key);
    if (current && now >= current.resetAt) {
      this.failures.delete(key);
    } else if (current) {
      return current.count >= this.options.maxFailures
        ? secondsUntil(current.resetAt, now)
        : undefined;
    }

    if (this.failures.size >= this.options.maxKeys) {
      this.removeExpired(now);
      if (this.failures.size >= this.options.maxKeys) {
        return this.retryAfterCapacitySeconds(now);
      }
    }
    return undefined;
  }

  // Never dropped, even at the cap: the key passed the cap check before its
  // check ran, so the cap is exceeded at most by the users checking at once.
  private recordFailure(key: string, now: number): void {
    const current = this.failures.get(key);
    if (current && now < current.resetAt) {
      current.count += 1;
      return;
    }
    this.failures.set(key, { count: 1, resetAt: now + this.options.windowMs });
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.failures) {
      if (now >= entry.resetAt) this.failures.delete(key);
    }
  }

  private retryAfterCapacitySeconds(now: number): number {
    let earliestResetAt = Number.POSITIVE_INFINITY;
    for (const entry of this.failures.values()) {
      earliestResetAt = Math.min(earliestResetAt, entry.resetAt);
    }
    return secondsUntil(earliestResetAt, now);
  }
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1_000));
}
