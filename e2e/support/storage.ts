import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import { MINIO_URL, storageSettings } from './env';

/**
 * A look at the object store behind the API, from the host. MinIO stands in
 * for Cloudflare R2, so this is how the tests check that a dump really landed
 * in storage (and that a failed backup left nothing there), independently of
 * what the API says about it.
 *
 * Requests are signed by hand with AWS Signature V4 (a few lines of node:crypto)
 * so the suite needs no S3 client library.
 */

// MinIO accepts any region name when none is configured, as the API relies on
// with its own `auto`.
const REGION = 'auto';
const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

// RFC 3986 percent-encoding, which is stricter than encodeURIComponent.
const encode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

async function signedRequest(
  method: 'GET' | 'DELETE',
  key: string,
  query: Record<string, string> = {},
): Promise<Response> {
  const { accessKeyId, secretAccessKey, bucket } = storageSettings();
  const url = new URL(MINIO_URL);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);

  const path = `/${[bucket, ...key.split('/').filter(Boolean)].map(encode).join('/')}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encode(name)}=${encode(query[name])}`)
    .join('&');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${url.host}\nx-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join('\n');

  const scope = `${day}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), REGION), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return fetch(`${MINIO_URL}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`, {
    method,
    headers: {
      'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
}

/** The text of an object, or `null` when the key does not exist. */
export async function readObject(key: string): Promise<string | null> {
  const response = await signedRequest('GET', key);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Reading ${key} from object storage failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.text();
}

/** Every key that starts with `prefix`. */
export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const response = await signedRequest('GET', '', {
      'list-type': '2',
      prefix,
      ...(token ? { 'continuation-token': token } : {}),
    });
    const xml = await response.text();
    if (!response.ok) {
      throw new Error(`Listing "${prefix}" in object storage failed: HTTP ${response.status} ${xml}`);
    }
    keys.push(...[...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1]
      : undefined;
  } while (token);

  return keys;
}

export async function deleteObjects(keys: string[]): Promise<void> {
  for (const key of keys) {
    const response = await signedRequest('DELETE', key);
    // S3 answers 204 whether or not the key existed.
    if (!response.ok) {
      throw new Error(`Deleting ${key} from object storage failed: HTTP ${response.status}`);
    }
  }
}

export interface DownloadedObject {
  status: number;
  bytes: number;
  sha256: string;
}

/**
 * Downloads a pre-signed URL from `download-url` and returns its size and
 * SHA-256. The URL points at `http://minio:9000/...`, a name that only exists
 * inside the Docker network, and the signature covers that host. From the host
 * the same server answers on the published port when the request keeps the
 * original `Host` header, so connect to localhost and send the header as is.
 */
export function downloadSignedUrl(signedUrl: string): Promise<DownloadedObject> {
  const target = new URL(signedUrl);
  const published = new URL(MINIO_URL);

  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: published.hostname,
        port: published.port,
        path: `${target.pathname}${target.search}`,
        headers: { Host: target.host },
      },
      (response) => {
        const hash = createHash('sha256');
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          hash.update(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, bytes, sha256: hash.digest('hex') }),
        );
      },
    );
    request.on('error', reject);
  });
}
