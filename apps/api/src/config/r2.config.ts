import { registerAs } from '@nestjs/config';

export const R2_BUCKET_TOKEN = 'R2_BUCKET';

export default registerAs('r2', () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

  // Optional override for S3-compatible stores other than Cloudflare R2 (e.g.
  // MinIO). A blank value counts as unset so an empty `R2_ENDPOINT=` line in an
  // env file keeps the default behaviour.
  const endpointOverride = process.env.R2_ENDPOINT || undefined;

  // Derive S3-compatible endpoint from account ID unless it is overridden
  const endpoint =
    endpointOverride ?? `https://${accountId}.r2.cloudflarestorage.com`;

  return {
    endpoint,
    // Self-hosted S3 servers are usually reached by a bare hostname such as
    // `minio`, which cannot serve the `<bucket>.<host>` virtual-hosted style
    // R2 uses, so they need the bucket in the path instead.
    forcePathStyle: endpointOverride !== undefined,
    accessKey: accessKeyId,
    secretKey: secretAccessKey,
    bucket: bucketName,
    publicBaseUrl,
  };
});
