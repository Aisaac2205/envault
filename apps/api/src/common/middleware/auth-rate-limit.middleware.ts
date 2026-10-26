import { NextFunction, Request, RequestHandler, Response } from 'express';

interface AuthRateLimitOptions {
  windowMs: number;
  maxRequests: number;
  maxKeys: number;
  sweepIntervalMs: number;
  now?: () => number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * In-memory fixed-window limiter for the supported single API replica.
 * Expired keys are swept opportunistically. Once the hard cap is reached,
 * unknown keys fail closed until a slot expires, so rotating addresses can
 * neither grow the heap nor reset an active attacker's bucket.
 */
export class AuthRateLimitStore {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly now: () => number;
  private nextSweepAt = 0;

  constructor(private readonly options: AuthRateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    this.sweepIfDue(now);

    const current = this.entries.get(key);
    if (current && now >= current.resetAt) {
      this.entries.set(key, {
        count: 1,
        resetAt: now + this.options.windowMs,
      });
      return { allowed: true };
    }

    if (current && current.count >= this.options.maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
      };
    }

    if (current) {
      current.count += 1;
      return { allowed: true };
    }

    // Capacity pressure must never reset an active attacker's bucket. Sweep
    // once more regardless of cadence, then reject the unknown key until the
    // earliest active window frees a slot.
    if (this.entries.size >= this.options.maxKeys) {
      this.removeExpired(now);
      if (this.entries.size >= this.options.maxKeys) {
        return {
          allowed: false,
          retryAfterSeconds: this.retryAfterCapacitySeconds(now),
        };
      }
    }

    this.entries.set(key, {
      count: 1,
      resetAt: now + this.options.windowMs,
    });
    return { allowed: true };
  }

  private sweepIfDue(now: number): void {
    if (now < this.nextSweepAt) return;

    this.removeExpired(now);
    this.nextSweepAt = now + this.options.sweepIntervalMs;
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key);
    }
  }

  private retryAfterCapacitySeconds(now: number): number {
    let earliestResetAt = Number.POSITIVE_INFINITY;
    for (const entry of this.entries.values()) {
      earliestResetAt = Math.min(earliestResetAt, entry.resetAt);
    }

    return Number.isFinite(earliestResetAt)
      ? Math.max(1, Math.ceil((earliestResetAt - now) / 1_000))
      : Math.max(1, Math.ceil(this.options.windowMs / 1_000));
  }
}

export function createAuthRateLimitMiddleware(
  options: AuthRateLimitOptions,
): RequestHandler {
  const store = new AuthRateLimitStore(options);

  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.method !== 'POST') {
      next();
      return;
    }

    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const decision = store.consume(key);

    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      response.status(429).json({ message: 'Too many requests' });
      return;
    }

    next();
  };
}
