import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  // R2 — required in production, optional in development
  R2_ACCOUNT_ID: Joi.string().allow('').default(''),
  R2_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  R2_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  R2_BUCKET_NAME: Joi.string().allow('').default(''),
  R2_PUBLIC_BASE_URL: Joi.string().uri().allow('').default(''),
  // Optional S3 endpoint override for S3-compatible stores such as MinIO. Leave
  // it unset (or blank) for Cloudflare R2: the endpoint is then derived from
  // R2_ACCOUNT_ID. When set, requests use path-style addressing.
  R2_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
  // Better Auth
  BETTER_AUTH_SECRET: Joi.string().required(),
  BETTER_AUTH_URL: Joi.string().uri().required(),
  BETTER_AUTH_ADMIN_EMAIL: Joi.string().email({ tlds: false }).optional(),
  BETTER_AUTH_ADMIN_PASSWORD: Joi.string().min(8).optional(),
  // Comma-separated list of allowed origins. No wildcard default — if you
  // forget to set it in production you open the API to any browser. Force
  // an explicit value (e.g. "http://localhost:5173,https://app.example.com").
  // AES-256-GCM key for encrypting connection passwords at rest.
  // Must be a 64-character hex string (32 bytes).
  ENCRYPTION_KEY: Joi.string().hex().length(64).required(),
  CORS_ORIGIN: Joi.string()
    .required()
    .custom((value: string, helpers) => {
      const origins = value.split(',').map((o) => o.trim());
      if (origins.some((o) => o.includes('*'))) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'Wildcard CORS rejection')
    .messages({
      'any.invalid': 'CORS_ORIGIN cannot contain wildcard (*)',
    }),
  // Rate limiting (requests per minute, per IP). Health endpoint is excluded.
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  // Better Auth bypasses Nest guards, so its middleware has a dedicated,
  // bounded single-replica limiter.
  AUTH_RATE_WINDOW_MS: Joi.number().integer().min(1_000).default(60_000),
  AUTH_RATE_MAX: Joi.number().integer().min(1).default(10),
  AUTH_RATE_MAX_KEYS: Joi.number().integer().min(100).default(10_000),
  AUTH_RATE_SWEEP_INTERVAL_MS: Joi.number()
    .integer()
    .min(1_000)
    .default(60_000),
  // Command timeout for pg_restore / mysql CLI in ms (dimensioned for up to 5 GB dumps).
  RESTORE_TIMEOUT_MS: Joi.number().integer().min(10_000).default(1_800_000),
  // How long the MySQL restore swap waits for each lock held by another session
  // on the target (ms), applied as lock_wait_timeout in whole seconds (1 s to 1 year).
  RESTORE_LOCK_WAIT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(31_536_000_000)
    .default(30_000),
  // Command timeout for pg_dump / mysqldump CLI in ms (dimensioned for massive dumps).
  BACKUP_TIMEOUT_MS: Joi.number().integer().min(10_000).default(1_800_000),
  // Directory with one subdirectory per installed PostgreSQL client major
  // (<root>/<major>/bin/pg_dump). Blank or unset uses the Debian/PGDG layout of
  // the API image (/usr/lib/postgresql); only set it for another layout.
  PG_CLIENT_BIN_ROOT: Joi.string().allow('').optional(),
  // Redis configuration for asynchronous BullMQ processing queues.
  // The localhost default only applies outside production; in production the
  // Redis target must be explicit (see the object-level rule below).
  REDIS_HOST: Joi.string().when('NODE_ENV', {
    is: 'production',
    otherwise: Joi.string().default('localhost'),
  }),
  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).optional(),
  REDIS_TLS: Joi.boolean().default(false),
})
  // Production must name its Redis target instead of silently falling back to
  // localhost. REDISURL and REDISHOST are the Railway aliases redis.config.ts
  // also reads; ConfigModule validates with allowUnknown, so they reach here.
  .when(Joi.object({ NODE_ENV: Joi.valid('production').required() }).unknown(), {
    then: Joi.object()
      .or('REDIS_URL', 'REDIS_HOST', 'REDISURL', 'REDISHOST')
      .messages({
        'object.missing':
          'REDIS_HOST is required in production unless REDIS_URL is set',
      }),
  });

