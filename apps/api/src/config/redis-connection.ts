import { ConfigService } from '@nestjs/config';

/**
 * Where a Redis client should connect. Either a connection URL (ioredis turns
 * TLS on by itself for a `rediss://` scheme) or discrete host/port settings.
 */
export type RedisConnectionTarget =
  | { url: string }
  | {
      host: string;
      port: number;
      password: string | undefined;
      tls: Record<string, never> | undefined;
    };

/**
 * Single source of truth for the Redis target shared by BullMQ and the SSE
 * pub/sub clients. Reads the `redis.*` namespace from `redis.config.ts` first
 * and falls back to the raw env keys. Client tuning (retry strategy,
 * `maxRetriesPerRequest`, ...) stays with each caller.
 */
export function buildRedisConnectionOptions(
  config: Pick<ConfigService, 'get'>,
): RedisConnectionTarget {
  const url = config.get<string>('redis.url') || config.get<string>('REDIS_URL');
  if (url) {
    return { url };
  }

  const host = config.get<string>('redis.host') || config.get<string>('REDIS_HOST', 'localhost');
  const port = config.get<number>('redis.port') || config.get<number>('REDIS_PORT', 6379);
  const password = config.get<string>('redis.password') || config.get<string>('REDIS_PASSWORD');
  const tls = config.get<boolean>('redis.tls') || config.get<boolean>('REDIS_TLS', false);

  return {
    host,
    port,
    password: password || undefined,
    tls: tls ? {} : undefined,
  };
}
