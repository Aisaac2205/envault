import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { R2Object } from './interfaces/r2-object.interface';

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(R2Service.name);

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('r2.endpoint');
    const accessKey = this.configService.get<string>('r2.accessKey');
    const secretKey = this.configService.get<string>('r2.secretKey');
    const bucket = this.configService.get<string>('r2.bucket');

    const isConfigured = !!(endpoint && accessKey && secretKey && bucket);

    if (!isConfigured) {
      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      if (nodeEnv === 'production') {
        throw new Error('R2 configuration is incomplete');
      }
      this.logger.warn(
        'R2 not configured — backup/restore features will be disabled. ' +
        'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.',
      );
      this.bucket = '';
      this.client = new S3Client({
        region: 'auto',
        endpoint: 'http://localhost:0',
        credentials: { accessKeyId: '', secretAccessKey: '' },
      });
      return;
    }

    this.bucket = bucket;

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    });
  }

  /** Returns true if R2 is properly configured and usable. */
  isAvailable(): boolean {
    return this.bucket !== '';
  }

  private healthCache: {
    status: 'up' | 'down' | 'unconfigured';
    latencyMs?: number;
    error?: string;
    cachedAt: number;
  } | null = null;

  async checkHealth(): Promise<{
    status: 'up' | 'down' | 'unconfigured';
    latencyMs?: number;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return { status: 'unconfigured' };
    }

    const now = Date.now();
    if (this.healthCache && now - this.healthCache.cachedAt < 30_000) {
      return {
        status: this.healthCache.status,
        latencyMs: this.healthCache.latencyMs,
        error: this.healthCache.error,
      };
    }

    const start = Date.now();
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          MaxKeys: 1,
        }),
      );
      const latencyMs = Date.now() - start;
      const result = { status: 'up' as const, latencyMs };
      this.healthCache = { ...result, cachedAt: now };
      return result;
    } catch (error) {
      const latencyMs = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      const result = {
        status: 'down' as const,
        latencyMs,
        error: message,
      };
      this.healthCache = { ...result, cachedAt: now };
      return result;
    }
  }


  async upload(
    key: string,
    stream: Readable,
    options?: {
      metadata?: Record<string, string>;
      partSize?: number;
      queueSize?: number;
      abortSignal?: AbortSignal;
    },
  ): Promise<void> {
    this.logger.debug(`Uploading to R2: ${key}`);
    const partSize = options?.partSize ?? 32 * 1024 * 1024;
    const queueSize = options?.queueSize ?? 4;

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        Metadata: options?.metadata,
      },
      partSize,
      queueSize,
      leavePartsOnError: false,
    });

    try {
      if (options?.abortSignal) {
        options.abortSignal.addEventListener(
          'abort',
          () => {
            upload.abort().catch((err) => {
              this.logger.warn(`Failed to abort R2 upload for ${key}: ${err.message}`);
            });
          },
          { once: true },
        );
      }

      await upload.done();
    } catch (error) {
      try {
        await upload.abort();
      } catch (abortErr) {
        this.logger.warn(`Error during upload.abort() for ${key}: ${abortErr}`);
      }
      throw error;
    }
  }

  async download(key: string): Promise<Readable> {
    this.logger.debug(`Downloading from R2: ${key}`);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`No body returned for key: ${key}`);
    }
    return response.Body as Readable;
  }

  async downloadJson<T>(key: string): Promise<T> {
    const stream = await this.download(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  }

  async list(prefix?: string): Promise<R2Object[]> {
    const results: R2Object[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of response.Contents ?? []) {
        results.push({
          key: obj.Key ?? '',
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(),
          etag: obj.ETag ?? '',
        });
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return results;
  }

  async delete(key: string): Promise<void> {
    this.logger.debug(`Deleting from R2: ${key}`);
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}
