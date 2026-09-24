/**
 * Type definitions for internationalization dictionary in EnVault Management
 * Strict typing with TypeScript mapped types
 */

export type Locale = 'es' | 'en';

export interface NavTranslations {
  gettingStarted: string;
  features: string;
  architecture: string;
  documentation: string;
  signIn: string;
  signUp: string;
}

export interface HeroTranslations {
  badgeText: string;
  badgeLink: string;
  headingPart1: string;
  headingPart2: string;
  subtitle: string;
  ctaPrimary: string;
  ctaSecondary: string;
  canvasTitle: string;
  canvasStatus: string;
  stats: {
    postgresVersion: string;
    targetDbs: string;
    storageSync: string;
    telemetry: string;
  };
}

export interface DashboardTranslations {
  navDashboard: string;
  navConnections: string;
  navDumps: string;
  navCronjobs: string;
  navRestore: string;
  navAudit: string;
  navSettings: string;
  toggleSidebar: string;
  accountRole: string;
  headerSubtitle: string;
  periodLabel: string;
  kpiDumpsCount: string;
  kpiStorageUsed: string;
  kpiRestoreSuccess: string;
  kpiActiveCrons: string;
  recentDumpsTitle: string;
  statusSuccess: string;
  statusFailed: string;
  statusRunning: string;
  statusPending: string;
}

export interface FeaturesTranslations {
  sectionBadge: string;
  title: string;
  subtitle: string;
  feature1Title: string;
  feature1Desc: string;
  feature2Title: string;
  feature2Desc: string;
  feature3Title: string;
  feature3Desc: string;
  feature4Title: string;
  feature4Desc: string;
  feature5Title: string;
  feature5Desc: string;
  codeCardLabel: string;
  codeCardConfidence: string;
  cardStatusApproved: string;
  cardIngestionSpeedLabel: string;
  cardRestoreRequirements: string;
  cardStorageCoverage: string;
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
  nav: NavTranslations;
  hero: HeroTranslations;
  dashboard: DashboardTranslations;
  features: FeaturesTranslations;
  docs: DocumentationTranslations;
  footer: FooterTranslations;
}
