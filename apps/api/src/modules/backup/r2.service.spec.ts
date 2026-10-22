/// <reference types="jest" />
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { R2Service } from './r2.service';
import { Upload } from '@aws-sdk/lib-storage';

jest.mock('@aws-sdk/lib-storage');

const baseConfig: Record<string, unknown> = {
  'r2.endpoint': 'https://account.r2.cloudflarestorage.com',
  'r2.accessKey': 'test-access-key',
  'r2.secretKey': 'test-secret-key',
  'r2.bucket': 'test-bucket',
  NODE_ENV: 'test',
};

/** Builds a service straight from a config map, bypassing the Nest container. */
function createService(overrides: Record<string, unknown> = {}): R2Service {
  const config = { ...baseConfig, ...overrides };
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => config[key] ?? defaultValue),
  } as unknown as ConfigService;
  return new R2Service(configService);
}

describe('R2Service', () => {
  let service: R2Service;
  let mockConfigService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        return baseConfig[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2Service,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<R2Service>(R2Service);
  });

  it('isAvailable returns true when R2 credentials and bucket are provided', () => {
    expect(service.isAvailable()).toBe(true);
  });

  it('upload configures multipart upload with 32MB partSize and queueSize 4', async () => {
    const mockDone = jest.fn().mockResolvedValue({});
    const mockAbort = jest.fn().mockResolvedValue({});
    (Upload as unknown as jest.Mock).mockImplementation((opts) => ({
      done: mockDone,
      abort: mockAbort,
      ...opts,
    }));

    const stream = Readable.from(['test content']);
    await service.upload('test.dump', stream, { metadata: { tag: 'unit' } });

    expect(Upload).toHaveBeenCalledWith(
      expect.objectContaining({
        partSize: 32 * 1024 * 1024,
        queueSize: 4,
        leavePartsOnError: false,
      }),
    );
    expect(mockDone).toHaveBeenCalled();
  });

  it('upload calls upload.abort() when upload fails', async () => {
    const mockAbort = jest.fn().mockResolvedValue({});
    const mockDone = jest.fn().mockRejectedValue(new Error('Network error'));
    (Upload as unknown as jest.Mock).mockImplementation((opts) => ({
      done: mockDone,
      abort: mockAbort,
      ...opts,
    }));

    const stream = Readable.from(['test content']);
    await expect(service.upload('failed.dump', stream)).rejects.toThrow('Network error');

    expect(mockAbort).toHaveBeenCalled();
  });

  describe('addressing style', () => {
    // Presigning is local (no network): the URL shape proves which addressing
    // style and endpoint the underlying S3 client was built with.
    it('uses virtual-hosted addressing against the derived R2 endpoint', async () => {
      const url = new URL(await service.getSignedUrl('dumps/a.dump', 900));

      expect(url.protocol).toBe('https:');
      expect(url.host).toBe('test-bucket.account.r2.cloudflarestorage.com');
      expect(url.pathname).toBe('/dumps/a.dump');
    });

    it('uses path-style addressing against the override endpoint when forcePathStyle is set', async () => {
      const overridden = createService({
        'r2.endpoint': 'http://minio:9000',
        'r2.forcePathStyle': true,
      });

      const url = new URL(await overridden.getSignedUrl('dumps/a.dump', 900));

      expect(url.origin).toBe('http://minio:9000');
      expect(url.pathname).toBe('/test-bucket/dumps/a.dump');
    });

    it('keeps virtual-hosted addressing when forcePathStyle is explicitly off', async () => {
      const derived = createService({ 'r2.forcePathStyle': false });

      const url = new URL(await derived.getSignedUrl('dumps/a.dump', 900));

      expect(url.host).toBe('test-bucket.account.r2.cloudflarestorage.com');
    });
  });

  describe('configuration completeness', () => {
    it.each([
      ['access key', 'r2.accessKey'],
      ['secret key', 'r2.secretKey'],
      ['bucket', 'r2.bucket'],
    ])('throws at boot in production when the %s is missing', (_label, key) => {
      expect(() => createService({ NODE_ENV: 'production', [key]: undefined })).toThrow(
        'R2 configuration is incomplete',
      );
    });

    it('still requires access key, secret key and bucket when an endpoint override is set', () => {
      expect(() =>
        createService({
          NODE_ENV: 'production',
          'r2.endpoint': 'http://minio:9000',
          'r2.forcePathStyle': true,
          'r2.bucket': undefined,
        }),
      ).toThrow('R2 configuration is incomplete');
    });

    it('boots in production with an endpoint override and S3 credentials', () => {
      const overridden = createService({
        NODE_ENV: 'production',
        'r2.endpoint': 'http://minio:9000',
        'r2.forcePathStyle': true,
      });

      expect(overridden.isAvailable()).toBe(true);
    });

    it('disables backup storage with a warning instead of throwing outside production', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const incomplete = createService({ 'r2.bucket': undefined });

      expect(incomplete.isAvailable()).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('R2 not configured'));
      warn.mockRestore();
    });
  });
});
