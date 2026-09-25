import type { CodeLanguage } from '../lib/highlight';

export type SnippetId = 'docker' | 'railway' | 'queues';

export const SNIPPET_LANGUAGES: Record<SnippetId, CodeLanguage> = {
  docker: 'yaml',
  railway: 'shell',
  queues: 'typescript',
};

export const SNIPPETS: Record<SnippetId, string> = {
  docker: `# docker-compose.yml (repo root)
services:
  api:
    image: envault-management-api:0.1.1
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: production
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  web:
    image: envault-management-web:0.1.1
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: production
    environment:
      API_UPSTREAM: api:\${PORT:-3000}
    ports:
      - "5173:80"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: \${DB_NAME:?required}
      POSTGRES_USER: \${DB_USER:?required}
      POSTGRES_PASSWORD: \${DB_PASSWORD:?required}
    volumes:
      - db_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command:
      - redis-server
      - --appendonly
      - yes
      - --requirepass
      - \${REDIS_PASSWORD:?required}
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  db_data:
  redis_data:`,

  railway: `# Railway: API, Web, Postgres & Redis
# Reference variables auto-fill these at deploy

# envault-api
DB_HOST=\${{Postgres.PGHOST}}
DB_PORT=\${{Postgres.PGPORT}}
DB_NAME=\${{Postgres.PGDATABASE}}
DB_USER=\${{Postgres.PGUSER}}
DB_PASSWORD=\${{Postgres.PGPASSWORD}}
REDIS_HOST=\${{Redis.REDISHOST}}
REDIS_PORT=\${{Redis.REDISPORT}}
REDIS_PASSWORD=\${{Redis.REDISPASSWORD}}
BETTER_AUTH_SECRET=<64-char-hex-string>
BETTER_AUTH_URL=https://<web-domain>
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-key>
R2_BUCKET_NAME=envault-dumps

# envault-web
VITE_APP_BASE_URL=https://<public-domain>
API_UPSTREAM=<api-private-domain>:3000`,

  queues: `// BullMQ Queue & Asynchronous Processing
// 1. Submit task -> HTTP 202 Accepted
const res = await fetch('/api/backups', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    connectionId: 'prod-postgres-db',
  }),
});
// 202 Accepted -> { jobId, status: "PENDING" }

// 2. BullMQ Worker with Concurrency Limit
@Processor('backup', { concurrency: 2 })
export class BackupProcessor extends WorkerHost {
  async process(job: Job<BackupPayload>) {
    return this.backupService.execute(
      job.data,
    );
  }
}

// 3. Two-Stage Coordinated Retention Purge
// Stage 1: Purge physical object in R2
// Stage 2: Purge job record in control DB`,
};

