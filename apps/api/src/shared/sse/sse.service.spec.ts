/// <reference types="jest" />
import { EventEmitter } from 'events';
import type { Redis } from 'ioredis';
import { firstValueFrom, Observable, toArray } from 'rxjs';
import { SseEvent, SseService } from './sse.service';
import { SseRedisClients } from './sse-redis.provider';

/**
 * In-memory stand-in for the two Redis connections SseService uses. One
 * `FakeRedisServer` is shared by every "replica" so a test can emit on one
 * SseService and subscribe on another, which is exactly what the real Redis
 * buys us across API replicas.
 */
class FakeRedisServer {
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();
  readonly ttls = new Map<string, number>();
  readonly subscribers = new Set<FakeSubscriber>();

  incr(key: string): number {
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }

  publish(channel: string, message: string): number {
    for (const subscriber of this.subscribers) subscriber.deliver(channel, message);
    return this.subscribers.size;
  }

  expireAll(): void {
    this.strings.clear();
    this.lists.clear();
    this.ttls.clear();
  }
}

class FakePipeline {
  private readonly ops: Array<() => unknown> = [];

  constructor(private readonly server: FakeRedisServer) {}

  rpush(key: string, value: string): this {
    this.ops.push(() => {
      const list = this.server.lists.get(key) ?? [];
      list.push(value);
      this.server.lists.set(key, list);
      return list.length;
    });
    return this;
  }

  ltrim(key: string, start: number, stop: number): this {
    this.ops.push(() => {
      const list = this.server.lists.get(key) ?? [];
      const from = start < 0 ? Math.max(0, list.length + start) : start;
      const to = stop < 0 ? list.length + stop + 1 : stop + 1;
      this.server.lists.set(key, list.slice(from, to));
      return 'OK';
    });
    return this;
  }

  expire(key: string, seconds: number): this {
    this.ops.push(() => {
      this.server.ttls.set(key, seconds);
      return 1;
    });
    return this;
  }

  publish(channel: string, message: string): this {
    this.ops.push(() => this.server.publish(channel, message));
    return this;
  }

  lrange(key: string): this {
    this.ops.push(() => [...(this.server.lists.get(key) ?? [])]);
    return this;
  }

  exists(key: string): this {
    this.ops.push(() => (this.server.strings.has(key) || this.server.lists.has(key) ? 1 : 0));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    await Promise.resolve();
    return this.ops.map((op) => [null, op()]);
  }
}

class FakePublisher {
  status = 'ready';
  quit = jest.fn(async () => 'OK');
  disconnect = jest.fn();

  constructor(private readonly server: FakeRedisServer) {}

  async incr(key: string): Promise<number> {
    await Promise.resolve();
    return this.server.incr(key);
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    await Promise.resolve();
    if (args.includes('NX') && this.server.strings.has(key)) return null;
    this.server.strings.set(key, value);
    const exIndex = args.indexOf('EX');
    if (exIndex >= 0) this.server.ttls.set(key, Number(args[exIndex + 1]));
    return 'OK';
  }

  multi(): FakePipeline {
    return new FakePipeline(this.server);
  }
}

class FakeSubscriber extends EventEmitter {
  status = 'ready';
  readonly patterns = new Set<string>();
  quit = jest.fn(async () => 'OK');
  disconnect = jest.fn();
  psubscribe = jest.fn(async (pattern: string) => {
    await Promise.resolve();
    this.patterns.add(pattern);
    this.server.subscribers.add(this);
    return this.patterns.size;
  });

  constructor(private readonly server: FakeRedisServer) {
    super();
  }

  deliver(channel: string, message: string): void {
    for (const pattern of this.patterns) {
      const prefix = pattern.replace(/\*$/, '');
      if (channel.startsWith(prefix)) this.emit('pmessage', pattern, channel, message);
    }
  }
}

function createReplica(server: FakeRedisServer): {
  service: SseService;
  publisher: FakePublisher;
  subscriber: FakeSubscriber;
} {
  const publisher = new FakePublisher(server);
  const subscriber = new FakeSubscriber(server);
  const clients: SseRedisClients = {
    publisher: publisher as unknown as Redis,
    subscriber: subscriber as unknown as Redis,
  };
  return { service: new SseService(clients), publisher, subscriber };
}

/** Lets every queued fake-Redis promise settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function collect(stream: Observable<SseEvent>): { events: SseEvent[]; done: () => boolean } {
  const events: SseEvent[] = [];
  let completed = false;
  stream.subscribe({
    next: (event) => events.push(event),
    complete: () => {
      completed = true;
    },
  });
  return { events, done: () => completed };
}

describe('SseService (Redis-backed)', () => {
  let server: FakeRedisServer;
  let replica: ReturnType<typeof createReplica>;
  let service: SseService;

  beforeEach(() => {
    server = new FakeRedisServer();
    replica = createReplica(server);
    service = replica.service;
  });

  it('subscribe() on a job that was never registered returns an already-closed stream, not a hanging one', async () => {
    const events = await firstValueFrom(service.subscribe('never-registered').pipe(toArray()));

    expect(events).toEqual([]);
  });

  it('keeps a registered job with no events yet open and delivers what arrives later', async () => {
    service.register('job-quiet');
    await service.flush();

    const stream = collect(service.subscribe('job-quiet'));
    await settle();
    expect(stream.done()).toBe(false);

    service.emit('job-quiet', { type: 'progress', payload: { percent: 5 } });
    await service.flush();
    await settle();

    expect(stream.events).toEqual([{ type: 'progress', payload: { percent: 5 } }]);
  });

  it('delivers events emitted after subscribe() (live progress) and closes on complete()', async () => {
    service.register('job-1');
    const stream = collect(service.subscribe('job-1'));
    await settle();

    service.emit('job-1', { type: 'progress', payload: { percent: 50 } });
    service.complete('job-1');
    await service.flush();
    await settle();

    expect(stream.events).toEqual([{ type: 'progress', payload: { percent: 50 } }]);
    expect(stream.done()).toBe(true);
  });

  it('replays the stored history to a subscriber that connects after the events were emitted', async () => {
    service.register('job-2');
    service.emit('job-2', { type: 'progress', payload: { percent: 10 } });
    service.emit('job-2', { type: 'progress', payload: { percent: 90 } });
    service.complete('job-2');
    await service.flush();

    const events = await firstValueFrom(service.subscribe('job-2').pipe(toArray()));

    expect(events).toEqual([
      { type: 'progress', payload: { percent: 10 } },
      { type: 'progress', payload: { percent: 90 } },
    ]);
  });

  it('serves a subscriber on another replica: history first, then live events, in order', async () => {
    const other = createReplica(server);
    service.register('job-x');
    service.emit('job-x', { type: 'progress', payload: { percent: 15 } });
    await service.flush();

    const stream = collect(other.service.subscribe('job-x'));
    await settle();
    service.emit('job-x', { type: 'progress', payload: { percent: 50 } });
    service.emit('job-x', { type: 'completed', payload: { jobId: 'job-x', completedAt: new Date('2026-01-01T00:00:00.000Z') } });
    await service.flush();
    await settle();

    expect(stream.events).toEqual([
      { type: 'progress', payload: { percent: 15 } },
      { type: 'progress', payload: { percent: 50 } },
      { type: 'completed', payload: { jobId: 'job-x', completedAt: new Date('2026-01-01T00:00:00.000Z') } },
    ]);
    expect(stream.done()).toBe(true);
  });

  it('never delivers an event twice when it arrives both in the history read and on the live channel', async () => {
    service.register('job-race');
    await service.flush();

    // Publish while the subscriber is between its PSUBSCRIBE and its history
    // read: the event lands in the history AND in the live buffer.
    const originalMulti = replica.publisher.multi.bind(replica.publisher);
    let injected = false;
    jest.spyOn(replica.publisher, 'multi').mockImplementation(() => {
      const pipeline = originalMulti();
      jest.spyOn(pipeline, 'lrange').mockImplementation(function (this: FakePipeline, key: string) {
        if (!injected) {
          injected = true;
          const record = JSON.stringify({ seq: 1, event: { type: 'progress', payload: { percent: 33 } } });
          server.lists.set(key, [record]);
          server.publish('sse:job:job-race', record);
        }
        return FakePipeline.prototype.lrange.call(this, key) as FakePipeline;
      });
      return pipeline;
    });

    const stream = collect(service.subscribe('job-race'));
    await settle();

    expect(stream.events).toEqual([{ type: 'progress', payload: { percent: 33 } }]);
  });

  it('completes the stream right after a terminal failed event, even before complete() is called', async () => {
    service.register('job-term');
    const stream = collect(service.subscribe('job-term'));
    await settle();

    service.emit('job-term', { type: 'failed', payload: { jobId: 'job-term', error: 'boom' } });
    await service.flush();
    await settle();

    expect(stream.events).toEqual([{ type: 'failed', payload: { jobId: 'job-term', error: 'boom' } }]);
    expect(stream.done()).toBe(true);
  });

  it('keeps per-job ordering even though emit() is fire-and-forget', async () => {
    service.register('job-order');
    for (let percent = 1; percent <= 20; percent += 1) {
      service.emit('job-order', { type: 'progress', payload: { percent } });
    }
    service.complete('job-order');
    await service.flush();

    const events = await firstValueFrom(service.subscribe('job-order').pipe(toArray()));

    expect(events.map((event) => (event.payload as { percent: number }).percent)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('caps the stored history and shortens its TTL to the grace window once the job is terminal', async () => {
    service.register('job-cap');
    for (let percent = 0; percent < 510; percent += 1) {
      service.emit('job-cap', { type: 'progress', payload: { percent } });
    }
    await service.flush();
    expect(server.lists.get('sse:job:job-cap:events')).toHaveLength(500);
    expect(server.ttls.get('sse:job:job-cap:events')).toBeGreaterThan(60);

    service.complete('job-cap');
    await service.flush();

    expect(server.ttls.get('sse:job:job-cap:events')).toBe(60);
    expect(server.ttls.get('sse:job:job-cap:seq')).toBe(60);
  });

  it('returns a closed stream once the history has expired after the grace window', async () => {
    service.register('job-5');
    service.complete('job-5');
    await service.flush();
    server.expireAll();

    const stream = collect(service.subscribe('job-5'));
    await settle();

    expect(stream.events).toEqual([]);
    expect(stream.done()).toBe(true);
  });

  it('shares one pattern subscription per process for every HTTP subscriber', async () => {
    service.register('job-a');
    service.register('job-b');
    await service.flush();

    collect(service.subscribe('job-a'));
    collect(service.subscribe('job-b'));
    collect(service.subscribe('job-a'));
    await settle();

    expect(replica.subscriber.psubscribe).toHaveBeenCalledTimes(1);
    expect(replica.subscriber.psubscribe).toHaveBeenCalledWith('sse:job:*');
  });

  it('recovers events published while the subscriber connection was down, once it reconnects', async () => {
    service.register('job-reconnect');
    service.emit('job-reconnect', { type: 'progress', payload: { percent: 10 } });
    await service.flush();
    replica.subscriber.emit('ready'); // initial connection

    const stream = collect(service.subscribe('job-reconnect'));
    await settle();

    // The subscriber drops: these publishes reach the history but nobody hears them.
    server.subscribers.delete(replica.subscriber);
    service.emit('job-reconnect', { type: 'progress', payload: { percent: 60 } });
    service.emit('job-reconnect', { type: 'failed', payload: { jobId: 'job-reconnect', error: 'boom' } });
    await service.flush();
    expect(stream.events).toEqual([{ type: 'progress', payload: { percent: 10 } }]);

    server.subscribers.add(replica.subscriber);
    replica.subscriber.emit('ready'); // reconnect
    await settle();

    expect(stream.events).toEqual([
      { type: 'progress', payload: { percent: 10 } },
      { type: 'progress', payload: { percent: 60 } },
      { type: 'failed', payload: { jobId: 'job-reconnect', error: 'boom' } },
    ]);
    expect(stream.done()).toBe(true);
  });

  it('does not re-read history on the first ready of the subscriber connection', async () => {
    service.register('job-first-ready');
    await service.flush();
    collect(service.subscribe('job-first-ready'));
    await settle();
    const multi = jest.spyOn(replica.publisher, 'multi');

    replica.subscriber.emit('ready');
    await settle();

    expect(multi).not.toHaveBeenCalled();
  });

  it('stops delivering to a subscriber after it unsubscribes', async () => {
    service.register('job-unsub');
    const received: SseEvent[] = [];
    const subscription = service.subscribe('job-unsub').subscribe((event) => received.push(event));
    await settle();

    subscription.unsubscribe();
    service.emit('job-unsub', { type: 'progress', payload: { percent: 70 } });
    await service.flush();
    await settle();

    expect(received).toEqual([]);
    expect(service.listenerCount('job-unsub')).toBe(0);
  });

  it('scrubs credentials out of log payloads before they are stored or delivered', async () => {
    service.register('job-log');
    const stream = collect(service.subscribe('job-log'));
    await settle();

    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    service.emit('job-log', {
      type: 'log',
      payload: {
        message: 'connecting with PGPASSWORD=hunter2 to postgres://admin:pw@10.0.0.5:5432/erp',
        timestamp,
      },
    });
    await service.flush();
    await settle();

    expect(stream.events).toEqual([
      {
        type: 'log',
        payload: { message: 'connecting with PGPASSWORD=*** to [REDACTED]', timestamp },
      },
    ]);
    expect(server.lists.get('sse:job:job-log:events')?.join('')).not.toContain('hunter2');
  });

  it('scrubs credentials out of failed payloads before they reach a subscriber', async () => {
    service.register('job-failed');
    const stream = collect(service.subscribe('job-failed'));
    await settle();

    service.emit('job-failed', {
      type: 'failed',
      payload: { jobId: 'job-failed', error: 'pg_restore failed: password=hunter2' },
    });
    await service.flush();
    await settle();

    expect(stream.events).toEqual([
      {
        type: 'failed',
        payload: { jobId: 'job-failed', error: 'pg_restore failed: password=***' },
      },
    ]);
  });

  it('leaves progress and completed payloads unchanged (dates survive the Redis round trip)', async () => {
    service.register('job-untouched');
    const completedAt = new Date('2026-01-01T00:00:00.000Z');
    service.emit('job-untouched', { type: 'progress', payload: { percent: 42 } });
    service.emit('job-untouched', {
      type: 'completed',
      payload: { jobId: 'job-untouched', completedAt },
    });
    await service.flush();

    const events = await firstValueFrom(service.subscribe('job-untouched').pipe(toArray()));

    expect(events).toEqual([
      { type: 'progress', payload: { percent: 42 } },
      { type: 'completed', payload: { jobId: 'job-untouched', completedAt } },
    ]);
  });

  it('logs and swallows a Redis write failure instead of breaking the caller', async () => {
    jest.spyOn(replica.publisher, 'incr').mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect(() =>
      service.emit('job-down', { type: 'progress', payload: { percent: 1 } }),
    ).not.toThrow();
    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('closes both Redis connections on module destroy after pending writes drain', async () => {
    service.register('job-shutdown');
    service.emit('job-shutdown', { type: 'progress', payload: { percent: 99 } });

    await service.onModuleDestroy();

    expect(server.lists.get('sse:job:job-shutdown:events')).toHaveLength(1);
    expect(replica.publisher.quit).toHaveBeenCalled();
    expect(replica.subscriber.quit).toHaveBeenCalled();
  });
});
