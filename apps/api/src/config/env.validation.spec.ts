import { envValidationSchema } from './env.validation';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/envault',
  BETTER_AUTH_SECRET: 'a-secure-test-secret',
  BETTER_AUTH_URL: 'http://localhost:3000',
  ENCRYPTION_KEY: 'a'.repeat(64),
  CORS_ORIGIN: 'http://localhost:5173',
};

describe('envValidationSchema auth rate limiting', () => {
  it('provides safe single-replica defaults', () => {
    const { error, value } = envValidationSchema.validate(validEnvironment);

    expect(error).toBeUndefined();
    expect(value.AUTH_RATE_WINDOW_MS).toBe(60_000);
    expect(value.AUTH_RATE_MAX).toBe(10);
    expect(value.AUTH_RATE_MAX_KEYS).toBe(10_000);
    expect(value.AUTH_RATE_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(value.RESTORE_TIMEOUT_MS).toBe(1_800_000);
    expect(value.BACKUP_TIMEOUT_MS).toBe(1_800_000);
    expect(value.REDIS_HOST).toBe('localhost');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.REDIS_TLS).toBe(false);
  });

  it.each([
    ['AUTH_RATE_WINDOW_MS', 999],
    ['AUTH_RATE_MAX', 0],
    ['AUTH_RATE_MAX_KEYS', 99],
    ['AUTH_RATE_SWEEP_INTERVAL_MS', 999],
    ['RESTORE_TIMEOUT_MS', 9_999],
    ['BACKUP_TIMEOUT_MS', 9_999],
    ['REDIS_PORT', 0],
    ['REDIS_PORT', 65536],
  ])('rejects an unsafe %s value', (name, unsafeValue) => {
    const { error } = envValidationSchema.validate({
      ...validEnvironment,
      [name]: unsafeValue,
    });

    expect(error).toBeDefined();
  });
});

describe('envValidationSchema Redis configuration', () => {
  it('accepts custom Redis host, port, password, and TLS', () => {
    const { error, value } = envValidationSchema.validate({
      ...validEnvironment,
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: 6380,
      REDIS_PASSWORD: 'redis-secret-pass',
      REDIS_TLS: true,
    });

    expect(error).toBeUndefined();
    expect(value.REDIS_HOST).toBe('redis.internal');
    expect(value.REDIS_PORT).toBe(6380);
    expect(value.REDIS_PASSWORD).toBe('redis-secret-pass');
    expect(value.REDIS_TLS).toBe(true);
  });

  it('accepts valid REDIS_URL with redis:// and rediss://', () => {
    const { error, value } = envValidationSchema.validate({
      ...validEnvironment,
      REDIS_URL: 'rediss://default:secret@redis.railway.internal:6379',
    });

    expect(error).toBeUndefined();
    expect(value.REDIS_URL).toBe('rediss://default:secret@redis.railway.internal:6379');
  });

  it('rejects invalid REDIS_URL scheme', () => {
    const { error } = envValidationSchema.validate({
      ...validEnvironment,
      REDIS_URL: 'http://localhost:6379',
    });

    expect(error).toBeDefined();
  });
});

describe('envValidationSchema CORS_ORIGIN', () => {
  it.each([
    '*',
    'http://localhost:5173,*',
    '*.example.com',
    'https://app.envault.com, *',
  ])('rejects wildcard origin: %s', (corsOrigin) => {
    const { error } = envValidationSchema.validate({
      ...validEnvironment,
      CORS_ORIGIN: corsOrigin,
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('wildcard');
  });

  it('accepts explicit comma-separated origins without wildcards', () => {
    const { error, value } = envValidationSchema.validate({
      ...validEnvironment,
      CORS_ORIGIN: 'http://localhost:5173,https://app.envault.com',
    });

    expect(error).toBeUndefined();
    expect(value.CORS_ORIGIN).toBe('http://localhost:5173,https://app.envault.com');
  });
});
