/**
 * Type definitions for internationalization dictionary in EnVault Management
 * Strict typing with TypeScript mapped types
 */

export type Locale = 'es' | 'en';

export interface HeroTranslations {
  title: string;
  subtitle: string;
  installCta: string;
  docsCta: string;
  sampleDataBadge: string;
  screenshotAlt: string;
}

export interface BackupProcessTranslations {
  badge: string;
  title: string;
  subtitle: string;
  step1Badge: string;
  step1Title: string;
  step1Desc: string;
  step2Badge: string;
  step2Title: string;
  step2Desc: string;
  step3Badge: string;
  step3Title: string;
  step3Desc: string;
  step4Badge: string;
  step4Title: string;
  step4Desc: string;
}

export interface InstallSectionTranslations {
  badge: string;
  title: string;
  subtitle: string;
  tabLinux: string;
  tabWindows: string;
  tabDocker: string;
  tabCompose: string;
  copyCode: string;
  copied: string;
  docsLink: string;
}

export interface FeaturesTranslations {
  title: string;
  subtitle: string;
  feature1Title: string;
  feature1Desc: string;
  feature3Title: string;
  feature3Desc: string;
  feature4Title: string;
  feature4Desc: string;
  feature5Title: string;
  feature5Desc: string;
  cardIngestionSpeedLabel: string;
  licenseTitle?: string;
  licenseDesc?: string;
}

export interface DocumentationTranslations {
  sectionBadge: string;
  title: string;
  subtitle: string;
  tabDocker: string;
  tabApiDump: string;
  tabApiRestore: string;
  copyCode: string;
  copied: string;
}

export interface FooterTranslations {
  tagline: string;
  systemsOperational: string;
  product: string;
  resources: string;
  company: string;
  legal: string;
  rightsReserved: string;
  productLinks: {
    backups: string;
    restore: string;
    cronjobs: string;
    auditLogs: string;
  };
  resourceLinks: {
    docs: string;
    apiKeys: string;
    dockerGuide: string;
    githubRepo: string;
  };
  companyLinks: {
    architecture: string;
    terms: string;
    privacy: string;
    security: string;
  };
}

export interface GithubStarTranslations {
  label: string;
  starsLabel: string;
  opensInNewTab: string;
}

export interface Dictionary {
  hero: HeroTranslations;
  backupProcess: BackupProcessTranslations;
  features: FeaturesTranslations;
  install: InstallSectionTranslations;
  docs: DocumentationTranslations;
  footer: FooterTranslations;
  githubStar: GithubStarTranslations;
}
