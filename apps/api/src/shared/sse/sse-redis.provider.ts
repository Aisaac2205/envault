import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis, RedisOptions } from 'ioredis';
import { buildRedisConnectionOptions } from '../../config/redis-connection';

export const SSE_REDIS = Symbol('SSE_REDIS');

/**
 * The two Redis connections one API process uses for job event streams.
 * Pub/sub puts an ioredis connection into subscriber mode, where it cannot
 * run regular commands, so history writes/reads and PUBLISH go through
 * `publisher` while `subscriber` is dedicated to the single pattern
 * subscription shared by every HTTP client of this process.
 */
export interface SseRedisClients {
  publisher: Redis;
  subscriber: Redis;
}

/**
 * Same Redis target as BullMQ (`buildRedisConnectionOptions`), with
 * SSE-specific tuning: `lazyConnect` defers the TCP connection until the
 * first command, and a bounded `maxRetriesPerRequest` keeps an SSE request
 * from hanging forever while Redis is down (BullMQ needs `null` there; these
 * connections do not).
 */
export function createSseRedisClient(config: ConfigService, connectionName: string): Redis {
  const tuning: RedisOptions = {
    connectionName,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
  };

  const target = buildRedisConnectionOptions(config);
  if ('url' in target) {
    return new Redis(target.url, tuning);
  }
  return new Redis({ ...tuning, ...target });
}

export const sseRedisProvider: Provider = {
  provide: SSE_REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): SseRedisClients => ({
    publisher: createSseRedisClient(config, 'envault-sse-publisher'),
    subscriber: createSseRedisClient(config, 'envault-sse-subscriber'),
  }),
};
