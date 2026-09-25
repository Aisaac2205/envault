import type { Dictionary } from '../types';

export const en: Dictionary = {
  features: {
    title: 'Backups that just work, without the babysitting',
    subtitle:
      'No more scripts to babysit or manual checklists before every restore. EnVault handles your database backups from start to finish, so nothing gets lost.',
    feature1Title: 'Backups on autopilot, even if you scale up',
    feature1Desc:
      'Set the schedule you want, hourly, daily, weekly, whatever fits your timezone, and forget about it. Even if you run more than one server, only one of them ever runs the backup, so you never end up with duplicates.',
    feature3Title: 'Watch every restore happen live',
    feature3Desc:
      "See exactly what's happening while a restore runs, right in your browser, in real time. No refreshing the page or wondering if it's still working.",
    feature4Title: 'Your backups live safely in the cloud',
    feature4Desc:
      "Every backup goes straight to Cloudflare's storage. Nothing sits on a local disk where it could get lost, and old backups clean themselves up once you decide how long to keep them.",
    feature5Title: 'A record nobody can quietly change',
    feature5Desc:
      "Every backup, download, setting change, and restore gets logged automatically. That record can't be edited or deleted afterward, not even by an administrator. Access stays simple too, just admins and regular users.",
    cardIngestionSpeedLabel: 'Status',
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
};
