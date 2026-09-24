import { API_BASE_URL_TOKEN, type DocContent } from './types';

export const en: DocContent = {
  pageTitle: 'Documentation | EnVault Management',
  pageDescription:
    'Technical guide to registering databases, scheduling automated backups, configuring Cloudflare R2 / S3, and safely restoring dumps in EnVault Management.',
  breadcrumbLabel: 'Architecture & API Guide',
  tocLabel: 'Table of contents',
  heroTitle: 'Technical Documentation',
  heroSubtitle:
    'Complete technical specification and integration manual for EnVault Management. Learn about distributed scheduler locks, REST endpoints, real-time SSE streaming, and multi-cloud storage.',
  copyCodeLabel: 'Copy code',
  copiedLabel: 'Copied!',
  navGroups: [
    { label: 'Introduction', sectionIds: ['getting-started', 'architecture-overview'] },
    {
      label: 'Deployment Guide',
      sectionIds: ['deployment-docker', 'control-db-requirements', 'storage-configuration'],
    },
    {
      label: 'API Reference',
      sectionIds: ['api-dumps-execute', 'api-restore-execute', 'api-sse-telemetry', 'api-audit-log'],
    },
    { label: 'Operations & DevOps', sectionIds: ['scheduler-locks-guide', 'retention-cleanup'] },
  ],
  sections: [
    {
      id: 'getting-started',
      navLabel: 'Overview',
      title: 'EnVault Management System Overview',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management is a centralized database operations and backup platform. It enables teams to register PostgreSQL and MySQL connections, schedule automated dumps with timezone-aware cron expressions, monitor live streaming progress via SSE, and execute verified restores with pre-flight integrity checks.',
        },
        { type: 'subheading', text: 'Non-Negotiable System Requirements' },
        {
          type: 'paragraph',
          text: 'The control database for EnVault Management MUST be PostgreSQL 16 or higher. The platform utilizes native enum types, JSONB columns, and concurrent transactions with distributed scheduler locks managed by TypeORM and NestJS 11.',
        },
        {
          type: 'table',
          headers: ['Component', 'Technology', 'Version', 'Purpose'],
          rows: [
            ['Control DB', 'PostgreSQL', '16+ (Required)', 'System state, distributed locks, encrypted credentials, and audit trail'],
            ['Backend API', 'NestJS', '11.0+', 'Modular monolith, streaming dump engine, and SSE telemetry endpoints'],
            ['Frontend Web', 'React & Vite', '19.1+ / Vite 6+', 'Administrative web control plane with TanStack Query'],
            ['Storage Bucket', 'Cloudflare R2 / S3', 'S3 API Compatible', 'Encrypted-at-rest object storage for gzip dump archives'],
          ],
        },
      ],
    },
    {
      id: 'architecture-overview',
      navLabel: 'Architecture',
      title: 'Zero-Trust Architecture & Distributed Locks',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management strictly decouples the control plane (where operational metadata lives) from managed client databases. All connection credentials are encrypted using AES-256-GCM and never sent unencrypted to client browsers.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `# Monorepo structure
apps/
  ├── api/     # NestJS 11 — Modular Monolith (Port 3000)
  ├── web/     # React 19 — Vertical Slice (Port 5173 / 80)
  └── landing/ # Astro 7 — SSG Showcase & Documentation (Port 4321)`,
        },
      ],
    },
    {
      id: 'deployment-docker',
      navLabel: 'Docker Deployment',
      title: 'Deploying with Docker Compose',
      blocks: [
        {
          type: 'paragraph',
          text: 'Launch the entire EnVault Management stack with a single command. The composition includes the NestJS API container, React web client, and an optimized PostgreSQL 16 container with persistent volume mounts.',
        },
        {
          type: 'code',
          language: 'yaml',
          code: `services:
  control-db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: envault_control
      POSTGRES_USER: envault
      POSTGRES_PASSWORD: \${CONTROL_DB_PASSWORD}
    volumes:
      - envault_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U envault -d envault_control"]
      interval: 5s
      timeout: 5s
      retries: 5

  envault-api:
    image: ghcr.io/envault/api:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - CONTROL_DB_HOST=control-db
      - CONTROL_DB_PORT=5432
      - CONTROL_DB_NAME=envault_control
      - STORAGE_BACKEND=r2
      - R2_BUCKET=prod-db-backups
    depends_on:
      control-db:
        condition: service_healthy

volumes:
  envault_data:`,
        },
      ],
    },
    {
      id: 'control-db-requirements',
      navLabel: 'Control DB',
      title: 'Control Database Configuration',
      blocks: [
        {
          type: 'paragraph',
          text: 'The TypeORM engine connects to the control database upon bootstrap and automatically applies pending schema migrations. Key tables include `connections`, `cronjobs`, `scheduler_locks`, `dump_executions`, and `audit_logs`.',
        },
      ],
    },
    {
      id: 'storage-configuration',
      navLabel: 'Cloud Storage',
      title: 'Cloudflare R2 and AWS S3 Setup',
      blocks: [
        {
          type: 'paragraph',
          text: 'Database dumps stream directly via multipart uploads to your configured object storage provider. This eliminates local disk exhaustion even when dumping databases of hundreds of gigabytes.',
        },
      ],
    },
    {
      id: 'api-dumps-execute',
      navLabel: 'API: Trigger Dump',
      title: 'REST Endpoint: Trigger Manual Backup',
      blocks: [
        {
          type: 'paragraph',
          text: 'Starts an asynchronous database dump task against a registered connection. Returns the job execution ID and SSE stream URL for live tracking.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/dumps/execute" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connectionId": "conn_prod_pg",
    "compression": "gzip",
    "retentionDays": 30,
    "lockTimeoutMs": 60000
  }'`,
        },
      ],
    },
    {
      id: 'api-restore-execute',
      navLabel: 'API: Restore Database',
      title: 'REST Endpoint: Restore Database Dump',
      blocks: [
        {
          type: 'paragraph',
          text: 'Executes the restoration of a backup archive to a designated target database connection. Supports non-destructive dry-run simulation (`dryRun: true`) to verify connectivity and schema state before applying statements.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/restore/execute" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "dumpId": "dump_2026_09_24_pg_main",
    "targetConnectionId": "conn_staging_pg",
    "dryRun": false,
    "verifyIntegritySha256": true
  }'`,
        },
      ],
    },
    {
      id: 'api-sse-telemetry',
      navLabel: 'API: SSE Telemetry',
      title: 'Live Job Telemetry via Server-Sent Events',
      blocks: [
        {
          type: 'paragraph',
          text: 'Subscribe to the live SSE stream to receive real-time stdout output, compression progress, bytes transferred, and final status without polling overhead.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -N -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/jobs/events?jobId=job_9412"`,
        },
      ],
    },
    {
      id: 'api-audit-log',
      navLabel: 'API: Audit Trail',
      title: 'Immutable Audit Logging',
      blocks: [
        {
          type: 'paragraph',
          text: 'Inspect the cryptographically verified event history of all administrative actions: backup triggers, dump downloads, connection credential modifications, and restore operations.',
        },
      ],
    },
    {
      id: 'scheduler-locks-guide',
      navLabel: 'Scheduler Locks',
      title: 'Mutual Exclusion with Distributed Scheduler Locks',
      blocks: [
        {
          type: 'paragraph',
          text: 'To prevent duplicate cron executions across scaled API worker pods, each scheduled job attempts to claim a row in the `scheduler_locks` table. If another replica already holds the lock for that connection within the active time window, the runner skips execution safely.',
        },
      ],
    },
    {
      id: 'retention-cleanup',
      navLabel: 'Retention & Cleanup',
      title: 'Retention Windows & Auto-Pruning',
      blocks: [
        {
          type: 'paragraph',
          text: 'The background maintenance scheduler automatically prunes dumps exceeding their designated retention limit, freeing object storage capacity and lowering cloud infrastructure costs.',
        },
      ],
    },
  ],
};
