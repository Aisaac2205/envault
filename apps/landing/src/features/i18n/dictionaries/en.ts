import type { Dictionary } from '../types';

export const en: Dictionary = {
  hero: {
    title: 'Scheduled backups for PostgreSQL and MySQL',
    subtitle:
      'EnVault is a free, self-hosted tool for backing up PostgreSQL and MySQL, with scheduled backups in your own Cloudflare R2 bucket. It brings that real data into your development and QA databases without risking production.',
    installCta: 'Install with Docker',
    docsCta: 'Read the docs',
    sampleDataBadge: 'Sample data',
    screenshotAlt:
      'EnVault Management dashboard showing the success rate, this week’s backups, how long each backup took, and the latest restore',
  },
  backupProcess: {
    badge: 'Process',
    title: 'How to back up PostgreSQL and MySQL',
    subtitle:
      'EnVault automates your backup lifecycle in 4 straightforward steps. Register your credentials, set your schedule, and restore into safe environments with schema simulation.',
    step1Badge: 'Step 1',
    step1Title: 'Register your database',
    step1Desc:
      'Provide connection credentials for your PostgreSQL or MySQL database and assign its environment. Production (PROD) connections remain immutable and read-only to prevent accidental overrides.',
    step2Badge: 'Step 2',
    step2Title: 'Schedule automatic backups',
    step2Desc:
      'Choose the timing that fits your traffic, daily at off-peak hours, weekly, or with a custom cron expression. Distributed locking guarantees only one worker runs the backup at a time.',
    step3Badge: 'Step 3',
    step3Title: 'Direct storage to Cloudflare R2',
    step3Desc:
      'Dumps stream directly to your Cloudflare R2 or S3-compatible bucket via multipart upload. Nothing is written to EnVault’s local disk, and aging files purge automatically according to your retention policy.',
    step4Badge: 'Step 4',
    step4Title: 'Restore to Dev or QA with Dry Run',
    step4Desc:
      'Never restore blindly. Dry Run compares source and target schemas, highlights row differences, lets you exclude tables, and blocks direct writes to production.',
  },
  features: {
    title: 'Backups that just work, without the babysitting',
    subtitle:
      'No more scripts to babysit or manual checklists before every restore. EnVault handles your database backups from start to finish, so nothing gets lost.',
    feature1Title: 'Backups on autopilot, even if you scale up',
    feature1Desc:
      'Set the schedule you want, hourly, daily, weekly, or custom cron, and forget about it. Distributed locking ensures only one server performs the dump even in multi-instance setups.',
    feature3Title: 'Watch every restore happen live',
    feature3Desc:
      "See exactly what's happening while a restore runs, right in your browser via real-time SSE events. No refreshing the page or wondering if it's still working.",
    feature4Title: 'Your backups live safely in the cloud',
    feature4Desc:
      'Every backup streams straight to Cloudflare R2 or S3-compatible storage. Nothing sits on a local disk where it could get lost, and old backups clean themselves up according to your retention rules.',
    feature5Title: 'A record nobody can quietly change',
    feature5Desc:
      "Every backup, download, setting change, and restore gets logged automatically. That record cannot be edited or deleted afterward, not even by an administrator.",
    cardIngestionSpeedLabel: 'Status',
    licenseTitle: 'Fair Source (FSL-1.1)',
    licenseDesc:
      'Free for internal use in companies and startups of any size. No competing commercial offerings, transitioning to Apache 2.0 two years after release.',
  },
  install: {
    badge: 'Getting Started',
    title: 'How to install?',
    subtitle:
      'Deploy EnVault in minutes on your own infrastructure, locally or in the cloud. Full sovereignty over your database assets.',
    tabLinux: 'Linux',
    tabWindows: 'Windows',
    tabDocker: 'Docker',
    tabCompose: 'Docker Compose',
    copyCode: 'Copy',
    copied: 'Copied!',
    docsLink: 'More on installation',
  },
  docs: {
    sectionBadge: 'Rapid Deployment',
    title: 'Ready to run in your private infrastructure',
    subtitle:
      'Deploy EnVault Management in minutes via Docker Compose or Railway. Keep complete sovereignty over your database credentials and dumps.',
    tabDocker: 'Docker Compose',
    tabApiDump: 'API: Trigger Backup',
    tabApiRestore: 'API: Restore Database',
    copyCode: 'Copy code',
    copied: 'Copied!',
  },
  footer: {
    tagline: 'The simple way to keep your databases backed up and easy to restore.',
    systemsOperational: 'All systems operational',
    product: 'Product',
    resources: 'Resources',
    company: 'Platform',
    legal: 'Legal',
    rightsReserved: 'All rights reserved.',
    productLinks: {
      backups: 'Backups & Dumps',
      restore: 'Safe Recovery',
      cronjobs: 'Scheduled Backups',
      auditLogs: 'Audit Registry',
    },
    resourceLinks: {
      docs: 'Documentation',
      apiKeys: 'REST API Endpoints',
      dockerGuide: 'Docker Compose Guide',
      githubRepo: 'GitHub Repository',
    },
    companyLinks: {
      architecture: 'System Architecture',
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      security: 'Security Model',
    },
  },
  githubStar: {
    label: 'Leave a star on GitHub',
    starsLabel: 'stars',
    opensInNewTab: '(opens in a new tab)',
  },
};
