import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => {
  const url = process.env.REDIS_URL || process.env.REDISURL;
  const host = process.env.REDIS_HOST || process.env.REDISHOST || 'localhost';
  const port = parseInt(
    process.env.REDIS_PORT || process.env.REDISPORT || '6379',
    10,
  );
  const password = process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || undefined;
  const tls = process.env.REDIS_TLS === 'true' || Boolean(url?.startsWith('rediss://'));

  return {
    url,
    host,
    port,
    password,
    tls,
  };
});
