/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { buildRedisConnectionOptions } from './redis-connection';

function configWith(values: Record<string, unknown>): Pick<ConfigService, 'get'> {
  return {
    get: ((key: string, defaultValue?: unknown) =>
      key in values ? values[key] : defaultValue) as ConfigService['get'],
  };
}

describe('buildRedisConnectionOptions', () => {
  it('uses the URL when one is configured, ignoring host/port settings', () => {
    const target = buildRedisConnectionOptions(
      configWith({
        'redis.url': 'redis://default:secret@cache.internal:6380',
        'redis.host': 'ignored-host',
        'redis.port': 1234,
      }),
    );

    expect(target).toEqual({ url: 'redis://default:secret@cache.internal:6380' });
  });

  it('falls back to the raw REDIS_URL env key', () => {
    const target = buildRedisConnectionOptions(configWith({ REDIS_URL: 'redis://cache:6379' }));

    expect(target).toEqual({ url: 'redis://cache:6379' });
  });

  it('passes a rediss:// URL through untouched so ioredis enables TLS from the scheme', () => {
    const target = buildRedisConnectionOptions(
      configWith({ 'redis.url': 'rediss://default:secret@cache.internal:6380', 'redis.tls': true }),
    );

    expect(target).toEqual({ url: 'rediss://default:secret@cache.internal:6380' });
  });

  it('enables TLS for host/port settings when REDIS_TLS is true', () => {
    const target = buildRedisConnectionOptions(
      configWith({ 'redis.host': 'cache.internal', 'redis.port': 6380, 'redis.tls': true }),
    );

    expect(target).toEqual({ host: 'cache.internal', port: 6380, password: undefined, tls: {} });
  });

  it('defaults to localhost:6379 without password or TLS when nothing is configured', () => {
    const target = buildRedisConnectionOptions(configWith({}));

    expect(target).toEqual({ host: 'localhost', port: 6379, password: undefined, tls: undefined });
  });

  it('reads the raw REDIS_* env keys when the redis namespace is absent', () => {
    const target = buildRedisConnectionOptions(
      configWith({
        REDIS_HOST: 'redis',
        REDIS_PORT: 6390,
        REDIS_PASSWORD: 'pw',
        REDIS_TLS: true,
      }),
    );

    expect(target).toEqual({ host: 'redis', port: 6390, password: 'pw', tls: {} });
  });

  it('treats an empty password as no password', () => {
    const target = buildRedisConnectionOptions(configWith({ 'redis.password': '' }));

    expect(target).toMatchObject({ password: undefined });
  });
});
