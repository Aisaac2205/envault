import { API_BASE_URL_TOKEN, type DocContent } from './types';

export const en: DocContent = {
  pageTitle: 'Documentation | EnVault Management',
  pageDescription:
    'A practical guide to registering databases, scheduling automated backups, configuring Cloudflare R2 storage, and restoring dumps safely in EnVault Management.',
  breadcrumbLabel: 'Architecture & API Guide',
  tocLabel: 'Table of contents',
  heroTitle: 'Documentation',
  heroSubtitle:
    'A practical guide to running EnVault Management yourself. Register your databases, schedule backups, watch jobs live, and restore safely when you need to.',
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
      sectionIds: [
        'api-dumps-execute',
        'api-restore-execute',
        'api-sse-telemetry',
        'api-audit-log',
        'other-languages',
      ],
    },
    { label: 'Operations & DevOps', sectionIds: ['scheduler-locks-guide', 'retention-cleanup'] },
  ],
  sections: [
    {
      id: 'getting-started',
      navLabel: 'Overview',
      title: 'What EnVault Management Does',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management is a self-hosted platform for backing up and restoring your databases. Register a PostgreSQL or MySQL connection, schedule backups on a cron expression with timezone support, and watch each job run live in your browser. When you need to bring data back, a dry run checks connectivity and schema compatibility before anything actually changes.',
        },
        { type: 'subheading', text: 'Before You Install It' },
        {
          type: 'paragraph',
          text: "EnVault Management keeps its own state, connections, schedules, encrypted credentials, and the audit trail, in a control database, and that control database has to run PostgreSQL 16 or newer. Older versions will not work. The platform depends on PostgreSQL's advisory locks and JSONB columns to coordinate jobs safely across replicas.",
        },
        {
          type: 'table',
          headers: ['Requirement', 'Version', 'Why it matters'],
          rows: [
            [
              'Control database',
              'PostgreSQL 16+',
              'Stores your connections, schedules, encrypted credentials, and the audit trail',
            ],
            [
              'Backup targets',
              'PostgreSQL or MySQL',
              'The databases you register to back up and restore',
            ],
            [
              'Object storage',
              'Cloudflare R2',
              'Where every dump is streamed and stored, over an S3-compatible API',
            ],
          ],
        },
      ],
    },
    {
      id: 'architecture-overview',
      navLabel: 'Architecture',
      title: 'How EnVault Keeps Data Safe',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault keeps its own control plane, where job metadata, schedules, and audit history live, separate from the databases it backs up. Connection credentials are encrypted with AES-256-GCM before they are stored, and they are never sent to your browser in plain text.',
        },
        { type: 'subheading', text: 'What That Buys You' },
        {
          type: 'list',
          items: [
            'Every user is either an admin or a regular user. There is no separate operator or read-only tier to configure.',
            'A restore can never target a connection marked as production, so a wrong click cannot overwrite a live database.',
            'Every mutation (a backup trigger, a download, a connection change, a restore attempt) is written to an audit log that cannot be edited or deleted afterward, not even by an admin.',
          ],
        },
      ],
    },
    {
      id: 'deployment-docker',
      navLabel: 'Docker Deployment',
      title: 'Deploying With Docker Compose',
      blocks: [
        {
          type: 'paragraph',
          text: 'You can bring up the whole stack, the API and a PostgreSQL 16 database, with a single command. The compose file below persists the control database to a named volume, so restarting the containers will not wipe your data.',
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
      title: 'Configuring the Control Database',
      blocks: [
        {
          type: 'paragraph',
          text: 'The control database schema is created and kept up to date automatically the first time the API starts, so there is no migration command to run by hand. It stores your registered connections, backup schedules, encrypted credentials, and the audit trail.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Point EnVault at a dedicated PostgreSQL database rather than reusing one of the databases you plan to back up. Keeping the control database separate makes restores and upgrades far less risky.',
        },
      ],
    },
    {
      id: 'storage-configuration',
      navLabel: 'Cloud Storage',
      title: 'Cloudflare R2 Storage Setup',
      blocks: [
        {
          type: 'paragraph',
          text: 'Every backup streams directly to Cloudflare R2 through a multipart upload while the dump is still running, so nothing touches local disk even when the source database is hundreds of gigabytes. R2 is the only storage backend EnVault supports today. There is no local-disk option and no other cloud provider to configure.',
        },
        {
          type: 'paragraph',
          text: 'Because R2 exposes an S3-compatible API, you set it up the same way you would set up any S3-compatible client. You just need an endpoint, a bucket name, and a pair of access keys with permission to read and write objects.',
        },
      ],
    },
    {
      id: 'api-dumps-execute',
      navLabel: 'API: Trigger Dump',
      title: 'REST Endpoint: Trigger a Manual Backup',
      blocks: [
        {
          type: 'paragraph',
          text: 'Starts an asynchronous backup job for a registered connection and returns its job ID right away, before the dump has actually finished running.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/backups" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f"
  }'`,
        },
      ],
    },
    {
      id: 'api-restore-execute',
      navLabel: 'API: Restore Database',
      title: 'REST Endpoint: Restore a Backup',
      blocks: [
        {
          type: 'paragraph',
          text: 'Restores a backup to a target connection. Set "isDryRun" to true first to verify connectivity and schema compatibility without touching any data, then send the same request with it set to false once you are confident. EnVault refuses the request outright if the target connection is marked as production.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -X POST "${API_BASE_URL_TOKEN}/restores" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceBackupId": "3f9c2b6e-4b1a-4e9d-9c2f-1a2b3c4d5e6f",
    "targetConnectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f",
    "isDryRun": true
  }'`,
        },
      ],
    },
    {
      id: 'api-sse-telemetry',
      navLabel: 'API: SSE Telemetry',
      title: 'Live Restore Progress via Server-Sent Events',
      blocks: [
        {
          type: 'paragraph',
          text: 'Restore jobs stream their progress over Server-Sent Events, a way for the server to push live updates to your browser or client without you having to poll for them. Open the stream for a restore job ID and you receive events as the job moves through each stage, ending with its final status.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -N -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/restores/job_9412/stream"`,
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Backup jobs do not stream progress yet. Poll the backup or job status endpoint instead to check whether one has finished.',
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
          text: 'Every mutation (a backup trigger, a download, a connection or credential change, a restore attempt) is written to an audit log automatically. A database trigger blocks any update or delete against that log, so even an administrator with direct database access cannot rewrite history.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/audit?pageSize=25"`,
        },
      ],
    },
    {
      id: 'other-languages',
      navLabel: 'Other Languages',
      title: 'Calling the API From Other Languages',
      blocks: [
        {
          type: 'paragraph',
          text: 'The examples above use curl, but EnVault exposes a plain REST API, so any HTTP client works fine.',
        },
        { type: 'subheading', text: 'Triggering a Backup From Your Own Code' },
        {
          type: 'paragraph',
          text: 'Here is the same manual backup trigger written for a couple of common runtimes.',
        },
        {
          type: 'codeGroup',
          label: 'Trigger a backup',
          variants: [
            {
              language: 'shell',
              label: 'curl',
              code: `curl -X POST "${API_BASE_URL_TOKEN}/backups" \\
  -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"connectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f"}'`,
            },
            {
              language: 'typescript',
              label: 'TypeScript (fetch)',
              code: `const response = await fetch('${API_BASE_URL_TOKEN}/backups', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.ENVAULT_API_TOKEN}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ connectionId: 'b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f' }),
});

const job = await response.json();
console.log(job.jobId);`,
            },
            {
              language: 'python',
              label: 'Python (requests)',
              code: `import os
import requests

response = requests.post(
    "${API_BASE_URL_TOKEN}/backups",
    headers={"Authorization": f"Bearer {os.environ['ENVAULT_API_TOKEN']}"},
    json={"connectionId": "b2d4e6f8-1a2b-3c4d-5e6f-7a8b9c0d1e2f"},
)

job = response.json()
print(job["jobId"])`,
            },
          ],
        },
      ],
    },
    {
      id: 'scheduler-locks-guide',
      navLabel: 'Scheduler Locks',
      title: 'Mutual Exclusion Across Replicas',
      blocks: [
        {
          type: 'paragraph',
          text: 'If you run more than one instance of the API for redundancy, EnVault still runs each scheduled job exactly once. Right before a cron job, a manual retention sweep, or a restore starts, the replica that picks it up acquires a PostgreSQL advisory lock scoped to that job and connection, and releases it once the work is done, whether it succeeded or failed. Any other replica that tries to pick up the same job while the lock is held simply skips it.',
        },
      ],
    },
    {
      id: 'retention-cleanup',
      navLabel: 'Retention & Cleanup',
      title: 'Retention Windows and Automatic Pruning',
      blocks: [
        {
          type: 'paragraph',
          text: 'Each connection has its own retention window, so you can keep thirty days of backups for one database and a year for another. A background job checks for dumps past their window and prunes them automatically, freeing storage without you having to step in.',
        },
        {
          type: 'paragraph',
          text: 'Before deleting anything for real, you can preview a cleanup to see exactly which dumps it would remove and how much storage it would free.',
        },
      ],
    },
  ],
};
