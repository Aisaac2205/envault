/**
 * Type definitions for internationalization dictionary in EnVault Management
 * Strict typing with TypeScript mapped types
 */

export type Locale = 'es' | 'en';

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

export interface Dictionary {
  features: FeaturesTranslations;
  docs: DocumentationTranslations;
  footer: FooterTranslations;
}
