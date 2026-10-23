import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable } from 'rxjs';
import { sanitizeMessage } from '../../common/sanitization/sanitize-message';
import { SSE_REDIS, SseRedisClients } from './sse-redis.provider';

export type SseEvent =
  | { type: 'progress'; payload: SseProgressPayload }
  | { type: 'log'; payload: SseLogPayload }
  | { type: 'completed'; payload: SseCompletedPayload }
  | { type: 'failed'; payload: SseFailedPayload };

export interface SseProgressPayload {
  percent: number;
}

export interface SseLogPayload {
  message: string;
  timestamp: Date;
}

export interface SseCompletedPayload {
  jobId: string;
  completedAt: Date;
}

export interface SseFailedPayload {
  jobId: string;
  error: string;
}

const KEY_PREFIX = 'sse:job:';
const CHANNEL_PATTERN = `${KEY_PREFIX}*`;

/** Events kept per job for late subscribers (same cap as the old in-memory replay). */
export const SSE_HISTORY_LIMIT = 500;

/**
 * TTL of a job's history while it is still running. Refreshed on every
 * event; generous because a PENDING backup can sit deferred behind a busy
 * connection for a long time without emitting anything.
 */
export const SSE_ACTIVE_TTL_SECONDS = 6 * 60 * 60;

/** How long a finished job stays replayable (the old COMPLETED_GRACE_MS). */
export const SSE_COMPLETED_GRACE_SECONDS = 60;

/**
 * One entry of a job's history list and of its pub/sub channel. `seq` comes
 * from a per-job Redis INCR, so it is unique across replicas and lets a
 * subscriber merge the history read with the live channel without
 * duplicates. `end` marks an explicit `complete()` and is never forwarded.
 */
type StoredRecord = { seq: number; event: SseEvent } | { seq: number; end: true };

type RecordListener = (record: StoredRecord) => void;

const channelOf = (jobId: string): string => `${KEY_PREFIX}${jobId}`;
const eventsKeyOf = (jobId: string): string => `${KEY_PREFIX}${jobId}:events`;
const seqKeyOf = (jobId: string): string => `${KEY_PREFIX}${jobId}:seq`;

function isTerminal(event: SseEvent): boolean {
  return event.type === 'completed' || event.type === 'failed';
}

function sanitizeEvent(event: SseEvent): SseEvent {
  switch (event.type) {
    case 'log':
      return {
        type: 'log',
        payload: { ...event.payload, message: sanitizeMessage(event.payload.message) },
      };
    case 'failed':
      return {
        type: 'failed',
        payload: { ...event.payload, error: sanitizeMessage(event.payload.error) },
      };
    default:
      return event;
  }
}

/** JSON turns Dates into ISO strings; restore them so subscribers see the emitted shape. */
function reviveEvent(event: SseEvent): SseEvent {
  switch (event.type) {
    case 'log':
      return { type: 'log', payload: { ...event.payload, timestamp: new Date(event.payload.timestamp) } };
    case 'completed':
      return {
        type: 'completed',
        payload: { ...event.payload, completedAt: new Date(event.payload.completedAt) },
      };
    default:
      return event;
  }
}

function bySeq(a: StoredRecord, b: StoredRecord): number {
  return a.seq - b.seq;
}

/**
 * Job event streams (backup/restore progress) backed by Redis so that any
 * API replica can serve the SSE endpoint for a job running on another one,
 * and a subscriber that connects late still gets the history.
 *
 * Per job: a capped list `sse:job:<id>:events` (history), a counter
 * `sse:job:<id>:seq` (ordering/dedupe) and a channel `sse:job:<id>` (live).
 * `emit`/`complete` are fire-and-forget for callers; writes for one job are
 * chained so they reach Redis in call order, and failures are logged, never
 * thrown into the backup/restore flow.
 */
@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger(SseService.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly listeners = new Map<string, Set<RecordListener>>();
  private patternSubscription: Promise<void> | null = null;
  private subscriberWasReady = false;

  constructor(@Inject(SSE_REDIS) clients: SseRedisClients) {
    this.publisher = clients.publisher;
    this.subscriber = clients.subscriber;
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      this.dispatch(channel, message);
    });
    this.subscriber.on('ready', () => {
      if (this.subscriberWasReady) {
        void this.resyncAfterReconnect();
      }
      this.subscriberWasReady = true;
    });
  }

  /** Marks the job as known so a subscriber waits for events instead of closing at once. */
  register(jobId: string): void {
    this.enqueue(jobId, async () => {
      await this.publisher.set(seqKeyOf(jobId), '0', 'EX', SSE_ACTIVE_TTL_SECONDS, 'NX');
    });
  }

  emit(jobId: string, event: SseEvent): void {
    const sanitized = sanitizeEvent(event);
    const ttl = isTerminal(sanitized) ? SSE_COMPLETED_GRACE_SECONDS : SSE_ACTIVE_TTL_SECONDS;
    this.enqueue(jobId, () => this.append(jobId, { event: sanitized }, ttl));
  }

  /** Closes every open stream of the job and keeps its history replayable for the grace window. */
  complete(jobId: string): void {
    this.enqueue(jobId, () => this.append(jobId, { end: true }, SSE_COMPLETED_GRACE_SECONDS));
  }

  /**
   * History first, then live events, deduplicated by `seq`; completes after
   * a terminal event (`completed`/`failed`) or `complete()`. A job with no
   * stored state (never registered, or expired after its grace window)
   * yields an already-closed stream.
   */
  subscribe(jobId: string): Observable<SseEvent> {
    return new Observable<SseEvent>((subscriber) => {
      const seen = new Set<number>();
      // Live records that arrive while the history is being read.
      let buffered: StoredRecord[] | null = [];
      let closed = false;

      const finish = (): void => {
        if (closed) return;
        closed = true;
        subscriber.complete();
      };

      const deliver = (record: StoredRecord): void => {
        if (closed || seen.has(record.seq)) return;
        seen.add(record.seq);
        if ('end' in record) {
          finish();
          return;
        }
        subscriber.next(record.event);
        if (isTerminal(record.event)) finish();
      };

      const release = this.addListener(jobId, (record) => {
        if (buffered) buffered.push(record);
        else deliver(record);
      });

      this.readHistory(jobId)
        .then(({ known, history }) => {
          if (closed) return;
          const live = buffered ?? [];
          buffered = null;
          if (!known && history.length === 0 && live.length === 0) {
            finish();
            return;
          }
          for (const record of [...history, ...live].sort(bySeq)) deliver(record);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`No se pudo leer el historial SSE del job ${jobId}: ${message}`);
          finish();
        });

      return () => {
        closed = true;
        release();
      };
    });
  }

  /** Resolves once every queued write has reached Redis (or failed and been logged). */
  async flush(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites.values()]);
    }
  }

  /** Active local subscribers of a job; exposed for diagnostics and tests. */
  listenerCount(jobId: string): number {
    return this.listeners.get(jobId)?.size ?? 0;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
    await Promise.all([this.close(this.subscriber), this.close(this.publisher)]);
  }

  private enqueue(jobId: string, write: () => Promise<void>): void {
    const previous = this.pendingWrites.get(jobId) ?? Promise.resolve();
    const next = previous.then(write).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`No se pudo publicar el evento SSE del job ${jobId}: ${message}`);
    });
    this.pendingWrites.set(jobId, next);
    void next.then(() => {
      if (this.pendingWrites.get(jobId) === next) this.pendingWrites.delete(jobId);
    });
  }

  private async append(
    jobId: string,
    body: { event: SseEvent } | { end: true },
    ttlSeconds: number,
  ): Promise<void> {
    const seq = await this.publisher.incr(seqKeyOf(jobId));
    const record = JSON.stringify({ seq, ...body });
    const results = await this.publisher
      .multi()
      .rpush(eventsKeyOf(jobId), record)
      .ltrim(eventsKeyOf(jobId), -SSE_HISTORY_LIMIT, -1)
      .expire(eventsKeyOf(jobId), ttlSeconds)
      .expire(seqKeyOf(jobId), ttlSeconds)
      .publish(channelOf(jobId), record)
      .exec();
    const failure = results?.find(([err]) => err)?.[0];
    if (failure) throw failure;
  }

  private async readHistory(jobId: string): Promise<{ known: boolean; history: StoredRecord[] }> {
    // Subscribe before reading so nothing published in between is lost; the
    // overlap is removed by `seq` dedupe.
    await this.ensurePatternSubscription();
    const results = await this.publisher
      .multi()
      .lrange(eventsKeyOf(jobId), 0, -1)
      .exists(seqKeyOf(jobId))
      .exec();
    if (!results) {
      throw new Error('transacción de lectura abortada');
    }
    const [[listErr, rawHistory], [existsErr, exists]] = results;
    if (listErr) throw listErr;
    if (existsErr) throw existsErr;

    const history = ((rawHistory as string[]) ?? [])
      .map((raw) => this.parse(jobId, raw))
      .filter((record): record is StoredRecord => record !== null)
      .sort(bySeq);
    return { known: Number(exists) > 0 || history.length > 0, history };
  }

  private ensurePatternSubscription(): Promise<void> {
    if (!this.patternSubscription) {
      this.patternSubscription = this.subscriber
        .psubscribe(CHANNEL_PATTERN)
        .then(() => undefined)
        .catch((err: unknown) => {
          // Let the next subscriber retry instead of caching the failure.
          this.patternSubscription = null;
          throw err;
        });
    }
    return this.patternSubscription;
  }

  /**
   * Anything published while the subscriber connection was down never
   * reaches this process, even after ioredis re-subscribes. Once the pattern
   * subscription is confirmed again, re-read the history of every job with a
   * local subscriber and feed it through the same listeners: `seq` dedupe
   * drops what was already delivered, and a missed terminal event closes the
   * stream.
   */
  private async resyncAfterReconnect(): Promise<void> {
    try {
      // Same connection, so this reply comes after ioredis' own re-subscribe.
      await this.subscriber.psubscribe(CHANNEL_PATTERN);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`No se pudo restablecer la suscripción SSE tras reconectar: ${message}`);
      return;
    }

    for (const jobId of [...this.listeners.keys()]) {
      try {
        const { history } = await this.readHistory(jobId);
        for (const record of history) {
          for (const listener of [...(this.listeners.get(jobId) ?? [])]) listener(record);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`No se pudo releer el historial SSE del job ${jobId} tras reconectar: ${message}`);
      }
    }
  }

  private dispatch(channel: string, message: string): void {
    if (!channel.startsWith(KEY_PREFIX)) return;
    const jobId = channel.slice(KEY_PREFIX.length);
    const jobListeners = this.listeners.get(jobId);
    if (!jobListeners || jobListeners.size === 0) return;
    const record = this.parse(jobId, message);
    if (!record) return;
    for (const listener of [...jobListeners]) listener(record);
  }

  private parse(jobId: string, raw: string): StoredRecord | null {
    try {
      const record = JSON.parse(raw) as StoredRecord;
      if ('end' in record) return record;
      return { seq: record.seq, event: reviveEvent(record.event) };
    } catch {
      this.logger.warn(`Se descartó un evento SSE ilegible del job ${jobId}`);
      return null;
    }
  }

  private addListener(jobId: string, listener: RecordListener): () => void {
    let jobListeners = this.listeners.get(jobId);
    if (!jobListeners) {
      jobListeners = new Set();
      this.listeners.set(jobId, jobListeners);
    }
    jobListeners.add(listener);
    return () => {
      const current = this.listeners.get(jobId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(jobId);
    };
  }

  private async close(client: Redis): Promise<void> {
    // A lazy client that never connected would open a connection just to
    // send QUIT; drop it locally instead.
    if (client.status !== 'ready') {
      client.disconnect();
      return;
    }
    await client.quit().catch(() => client.disconnect());
  }
}
