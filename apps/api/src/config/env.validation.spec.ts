import { envValidationSchema } from './env.validation';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/vaultly',
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
  });

  it.each([
    ['AUTH_RATE_WINDOW_MS', 999],
    ['AUTH_RATE_MAX', 0],
    ['AUTH_RATE_MAX_KEYS', 99],
    ['AUTH_RATE_SWEEP_INTERVAL_MS', 999],
    ['RESTORE_TIMEOUT_MS', 9_999],
  ])('rejects an unsafe %s value', (name, unsafeValue) => {
    const { error } = envValidationSchema.validate({
      ...validEnvironment,
      [name]: unsafeValue,
    });

    expect(error).toBeDefined();
  });
});
