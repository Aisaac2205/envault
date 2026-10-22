/// <reference types="jest" />
import r2Config from './r2.config';

const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
  'R2_ENDPOINT',
] as const;

describe('r2 config', () => {
  const originalEnv: Partial<Record<(typeof R2_ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of R2_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.R2_ACCESS_KEY_ID = 'test-access-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.R2_BUCKET_NAME = 'test-bucket';
  });

  afterEach(() => {
    for (const key of R2_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  describe('when R2_ENDPOINT is unset', () => {
    it('derives the Cloudflare endpoint from the account id', async () => {
      process.env.R2_ACCOUNT_ID = 'acct123';

      const config = await r2Config();

      expect(config.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
    });

    it('keeps virtual-hosted addressing (path-style off)', async () => {
      process.env.R2_ACCOUNT_ID = 'acct123';

      const config = await r2Config();

      expect(config.forcePathStyle).toBe(false);
    });

    it('treats a blank R2_ENDPOINT as unset', async () => {
      process.env.R2_ACCOUNT_ID = 'acct123';
      process.env.R2_ENDPOINT = '';

      const config = await r2Config();

      expect(config.endpoint).toBe('https://acct123.r2.cloudflarestorage.com');
      expect(config.forcePathStyle).toBe(false);
    });
  });

  describe('when R2_ENDPOINT is set', () => {
    it('uses the override instead of the derived endpoint', async () => {
      process.env.R2_ACCOUNT_ID = 'acct123';
      process.env.R2_ENDPOINT = 'http://minio:9000';

      const config = await r2Config();

      expect(config.endpoint).toBe('http://minio:9000');
    });

    it('turns path-style addressing on', async () => {
      process.env.R2_ENDPOINT = 'http://minio:9000';

      const config = await r2Config();

      expect(config.forcePathStyle).toBe(true);
    });

    it('does not need R2_ACCOUNT_ID to produce a usable endpoint', async () => {
      process.env.R2_ENDPOINT = 'http://minio:9000';

      const config = await r2Config();

      expect(config.endpoint).toBe('http://minio:9000');
      expect(config.endpoint).not.toContain('undefined');
    });
  });

  it.each([
    ['unset', undefined],
    ['set', 'http://minio:9000'],
  ])(
    'exposes the credentials, bucket and public base URL unchanged when R2_ENDPOINT is %s',
    async (_label, endpoint) => {
      process.env.R2_ACCOUNT_ID = 'acct123';
      process.env.R2_PUBLIC_BASE_URL = 'https://dumps.example.com/';
      if (endpoint) process.env.R2_ENDPOINT = endpoint;

      const config = await r2Config();

      expect(config).toMatchObject({
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
        bucket: 'test-bucket',
        publicBaseUrl: 'https://dumps.example.com/',
      });
    },
  );
});
