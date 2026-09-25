import { API_BASE_URL_TOKEN, type DocContent } from './types';

export const en: DocContent = {
  pageTitle: 'Documentation | EnVault Management',
  pageDescription:
    'Technical guide to registering databases, scheduling automated backups, configuring Cloudflare R2 storage, and restoring database dumps safely with EnVault Management.',
  breadcrumbLabel: 'Architecture & API Guide',
  tocLabel: 'Table of Contents',
  heroTitle: 'Documentation',
  heroSubtitle:
    'Technical guide to deploying and operating EnVault Management. Register database connections, schedule periodic backups, track jobs in real time, and execute controlled restorations.',
  copyCodeLabel: 'Copy code',
  copiedLabel: 'Copied!',
  navGroups: [
    {
      label: 'Introduction',
      sectionIds: ['getting-started', 'architecture-overview', 'environments-guide'],
    },
    {
      label: 'Deployment Guide',
      sectionIds: ['deployment-docker', 'control-db-requirements', 'storage-configuration'],
    },
    {
      label: 'Security & Access',
      sectionIds: ['auth-user-limits', 'audit-trail-observability'],
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
    {
      label: 'Operations & DevOps',
      sectionIds: ['scheduler-locks-guide', 'retention-cleanup'],
    },
  ],
  sections: [
    {
      id: 'getting-started',
      navLabel: 'Overview',
      title: 'What EnVault Management Does',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault Management is a self-hosted platform for backing up databases and restoring them when required. It allows you to register connections to PostgreSQL or MySQL, schedule backups using cron expressions with a defined timezone, and track job executions live directly in the browser. Before executing a real restoration, you can run a dry-run test that verifies network connectivity and schema compatibility without modifying existing tables.',
        },
        { type: 'subheading', text: 'Infrastructure requirements' },
        {
          type: 'paragraph',
          text: 'EnVault Management stores its internal state, including registered connections, schedules, encrypted credentials, and audit logs, in a dedicated control database. This control database requires PostgreSQL 16 or newer due to native advisory locking mechanisms and structured JSONB columns.',
        },
        {
          type: 'table',
          headers: ['Requirement', 'Version', 'Purpose'],
          rows: [
            [
              'Control database',
              'PostgreSQL 16+',
              'Stores connections, cronjobs, encrypted credentials, and audit logs',
            ],
            [
              'Backed up databases',
              'PostgreSQL or MySQL',
              'Target database instances registered for backup and restore tasks',
            ],
            [
              'Object storage',
              'Cloudflare R2 / S3',
              'Destination where dumps stream and persist via an S3-compatible API',
            ],
          ],
        },
      ],
    },
    {
      id: 'architecture-overview',
      navLabel: 'Architecture',
      title: 'Data Isolation and Security Guarantees',
      blocks: [
        {
          type: 'paragraph',
          text: 'EnVault keeps its control plane completely decoupled from the databases it manages. Database credentials are encrypted with authenticated AES-256-GCM before writing to disk, and they are never returned in plaintext to the client application.',
        },
        { type: 'subheading', text: 'Operational guarantees' },
        {
          type: 'list',
          items: [
            'Strict privilege separation between administrators and standard operators.',
            'Hard boundary preventing any production database from being selected as a restore target.',
            'Immutable audit trail recording every mutation and authentication attempt without allowing deletion.',
          ],
        },
      ],
    },
    {
      id: 'environments-guide',
      navLabel: 'Environments & Segregation',
      title: 'Standard Environments and Segregation Model',
      blocks: [
        {
          type: 'paragraph',
          text: 'Every database connection registered in EnVault is assigned to one of three standard environments, specifically production (prod), quality assurance (qa), or development (dev). This separation reflects canonical software engineering practices to isolate credentials and apply distinct operational rules based on data sensitivity.',
        },
        { type: 'subheading', text: 'Production write safeguards' },
        {
          type: 'paragraph',
          text: 'The assigned environment governs what actions can be executed on each connection. EnVault strictly blocks any connection flagged as production from serving as a restore destination. This architectural barrier ensures that manual errors or automated scripts cannot overwrite live production data.',
        },
        { type: 'subheading', text: 'Current immutability and roadmap' },
        {
          type: 'paragraph',
          text: 'In the current release, these three environments are immutable and validated directly by the control plane schema to maintain operational predictability. The development roadmap includes support for custom environments, allowing engineering teams to register specialized tiers such as staging, uat, or sandboxes to match complex deployment topologies.',
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
          text: 'You can deploy EnVault and its PostgreSQL 16 control database using a declarative composition file. A named volume preserves control data and connection secrets across container recycles.',
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
      navLabel: 'Control Database',
      title: 'Configuring the Control Database',
      blocks: [
        {
          type: 'paragraph',
          text: 'The control database schema initializes and migrates automatically when the application starts for the first time. This database stores connections, cron schedules, encrypted credentials, and the immutable audit log.',
        },
        {
          type: 'callout',
          tone: 'info',
          text: 'Connect EnVault to a dedicated PostgreSQL database that remains isolated from the databases you intend to back up. Keeping the control database independent guarantees availability during recovery procedures.',
        },
      ],
    },
    {
      id: 'storage-configuration',
      navLabel: 'Cloud Storage',
      title: 'Configuring Cloudflare R2 Storage',
      blocks: [
        {
          type: 'paragraph',
          text: 'Every backup streams directly to object storage through multipart transfers while the dump binary executes. This streaming pipeline avoids spooling temporary archives onto the local file system, allowing large databases to back up without filling local ephemeral disks.',
        },
        {
          type: 'paragraph',
          text: 'Cloudflare R2 provides full S3 protocol compatibility. You can configure the storage driver by specifying the endpoint address, bucket name, and access keys with read and write permissions.',
        },
      ],
    },
    {
      id: 'auth-user-limits',
      navLabel: 'Authentication & Users',
      title: 'Access Control and User Creation Limits',
      blocks: [
        {
          type: 'paragraph',
          text: 'Access to the web interface and protected endpoints is handled by an integrated authentication subsystem that manages sessions using secure cookies with SameSite lax and httpOnly attributes. This configuration blocks token extraction by untrusted browser scripts.',
        },
        { type: 'subheading', text: 'Closed registration model' },
        {
          type: 'paragraph',
          text: 'Because EnVault safeguards enterprise data infrastructure, public self-registration is intentionally disabled. The user interface does not expose public signup forms. The initial administrator account is provisioned automatically during initial system boot through server environment variables.',
        },
        { type: 'subheading', text: 'Operator hierarchy and management' },
        {
          type: 'paragraph',
          text: 'The authorization layer enforces two distinct roles, administrator and operator. Once the platform is operational, authenticated administrators retain sole authority to register additional operator accounts or revoke credentials, preserving an audited access boundary.',
        },
      ],
    },
    {
      id: 'audit-trail-observability',
      navLabel: 'Audit Trail',
      title: 'Forensic Audit Trail and Observability',
      blocks: [
        {
          type: 'paragraph',
          text: 'Every credential mutation, connection update, scheduled job execution, and authentication event generates an entry in the control database audit table. Database integrity rules prevent updates or deletions on this table, creating an tamper-resistant activity record.',
        },
        { type: 'subheading', text: 'Captured forensic metadata' },
        {
          type: 'paragraph',
          text: 'Each audit entry records the user identifier, username, source IP address, user agent, HTTP method, route, affected environment, ISO timestamp, execution outcome, and a severity rating categorized as low, medium, high, or critical.',
        },
        { type: 'subheading', text: 'Multi-criteria filtering and detailed inspection' },
        {
          type: 'paragraph',
          text: 'The web audit console provides search filters combining user, environment, resource type, execution state, and time ranges. The event detail view exposes sanitized request payloads, query parameters, duration metrics, and storage volumes without leaking sensitive credentials, providing compliance evidence for standards such as SOC 2 and ISO 27001.',
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
          text: 'Initiates an asynchronous backup job for a registered connection and returns its job identifier immediately, without waiting for the dump stream to finish.',
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
      navLabel: 'API: Restore Dump',
      title: 'REST Endpoint: Restore a Backup',
      blocks: [
        {
          type: 'paragraph',
          text: 'Restores a backup archive onto a specified target connection. Sending isDryRun as true verifies connectivity and schema compatibility without altering table rows. Setting isDryRun to false runs the real restore. If the target connection is marked as production, the request is rejected immediately.',
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
      title: 'Live Restore Progress with Server-Sent Events',
      blocks: [
        {
          type: 'paragraph',
          text: 'Restore jobs stream progress updates through Server-Sent Events (SSE), delivering real-time execution steps without polling overhead. Connecting to the stream route for a given job identifier provides continuous state transitions until completion.',
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
          text: 'Backup jobs currently emit an event when finished. To inspect the intermediate status of a running backup, query the jobs endpoint.',
        },
      ],
    },
    {
      id: 'api-audit-log',
      navLabel: 'API: Audit Logs',
      title: 'Immutable Audit Log Endpoint',
      blocks: [
        {
          type: 'paragraph',
          text: 'System alterations persist in the control database audit table. The audit endpoint supports querying event records with filters for environment, resource type, and pagination.',
        },
        {
          type: 'code',
          language: 'shell',
          code: `curl -H "Authorization: Bearer $ENVAULT_API_TOKEN" \\
  "${API_BASE_URL_TOKEN}/audit?environment=prod&resourceType=backup&pageSize=25"`,
        },
      ],
    },
    {
      id: 'other-languages',
      navLabel: 'Other Languages',
      title: 'Calling the API from Other Languages',
      blocks: [
        {
          type: 'paragraph',
          text: 'The HTTP interface follows standard REST patterns, allowing applications to trigger and monitor backups from any programming language.',
        },
        { type: 'subheading', text: 'Triggering a backup from code' },
        {
          type: 'paragraph',
          text: 'Examples illustrating how to call the backup endpoint using standard HTTP client libraries.',
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
      title: 'Mutual Exclusion Across Replicas with Advisory Locks',
      blocks: [
        {
          type: 'paragraph',
          text: 'When deploying multiple EnVault instances behind a load balancer for high availability, the platform guarantees that each scheduled cronjob, retention sweep, and restore runs once. Distributed coordination relies natively on PostgreSQL advisory locks, eliminating the need to maintain separate external memory clusters.',
        },
        { type: 'subheading', text: 'Non-blocking acquisition' },
        {
          type: 'paragraph',
          text: 'Immediately before starting a job, the worker replica calculates a 64-bit numeric key from the connection identifier and job category. It invokes the native pg_try_advisory_lock function on the control database. If another replica already holds the lock, the call returns false non-blockingly, allowing the replica to skip the tick without connection delays.',
        },
        { type: 'subheading', text: 'Release guarantees' },
        {
          type: 'paragraph',
          text: 'The advisory lock remains held strictly during execution and releases inside a guaranteed finalization block when the task finishes, whether it succeeded or failed. If a container stops unexpectedly or a worker crashes, the PostgreSQL engine automatically releases session-level locks as soon as the underlying TCP connection closes.',
        },
      ],
    },
    {
      id: 'retention-cleanup',
      navLabel: 'Retention & Cleanup',
      title: 'Retention Windows and Automated Pruning',
      blocks: [
        {
          type: 'paragraph',
          text: 'Each database connection defines an independent retention policy specified in days, allowing teams to keep seven days of backups for ephemeral development environments and three hundred and sixty-five days for production. A background worker periodically inspects the control database to locate dumps whose creation timestamp has surpassed the configured window.',
        },
        { type: 'subheading', text: 'Coordinated two-phase deletion' },
        {
          type: 'paragraph',
          text: 'The pruning procedure runs in two coordinated steps to prevent orphaned files in cloud storage or missing references in the control database. First, it issues deletion commands to the remote object storage bucket, and once removal is confirmed, it purges the corresponding metadata record from the control database.',
        },
        { type: 'subheading', text: 'Non-destructive simulation' },
        {
          type: 'paragraph',
          text: 'To evaluate retention rules safely before applying permanent deletions, EnVault supports running cleanups in simulation mode. This operation evaluates the retention policy and reports the exact list of dumps eligible for removal, their identifiers, and the total storage volume in bytes that will be reclaimed, without removing any data from object storage.',
        },
      ],
    },
  ],
};
