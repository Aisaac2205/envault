export const BACKUP_QUEUE_NAME = 'backup';

/** Connection lease TTL. Crash recovery within 5 minutes; long dumps stay
 * safe via the heartbeat, not the TTL. */
export const BACKUP_LEASE_TTL_MS = 300_000;

/** Heartbeat renewal interval (TTL / 5, single in-flight renew). */
export const BACKUP_LEASE_HEARTBEAT_MS = 60_000;

/** A renew error is only logged until this many ms before the lease would
 * expire from the last confirmed renewal; past that point it counts as lost. */
export const BACKUP_LEASE_RENEWAL_DEADLINE_MS = BACKUP_LEASE_TTL_MS - 30_000;

/** Busy-connection deferral backoff bounds and base:
 * min(300s, 30s * 2^n) * (0.8-1.2 jitter). */
export const BACKUP_BUSY_BACKOFF_MAX_MS = 300_000;
export const BACKUP_BUSY_BACKOFF_BASE_MS = 30_000;
export const BACKUP_BUSY_BACKOFF_JITTER_MIN = 0.8;
export const BACKUP_BUSY_BACKOFF_JITTER_MAX = 1.2;
