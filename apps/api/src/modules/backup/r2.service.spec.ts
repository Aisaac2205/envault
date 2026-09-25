/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { R2Service } from './r2.service';
import { Upload } from '@aws-sdk/lib-storage';

jest.mock('@aws-sdk/lib-storage');

describe('R2Service', () => {
  let service: R2Service;
  let mockConfigService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const config: Record<string, unknown> = {
          'r2.endpoint': 'https://account.r2.cloudflarestorage.com',
          'r2.accessKey': 'test-access-key',
          'r2.secretKey': 'test-secret-key',
          'r2.bucket': 'test-bucket',
          NODE_ENV: 'test',
        };
        return config[key] ?? defaultValue;
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
});
