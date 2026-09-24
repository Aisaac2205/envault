/**
 * Mock data for the Qably dashboard preview.
 * Shapes faithfully mirror apps/web so the landing preview is a 1:1 replica of the real product.
 */
import type {
  DashboardChannelDailyPoint,
  DashboardProjectRow,
  DashboardRecentRun,
  RunCaseCounts,
} from '@qably/types'

export interface MockHeroPoint {
  id: string
  label: string
  current: number
  previous: number
  passed: number
  failed: number
  blocked: number
}

export interface MockKpiMetric {
  value: string
  delta?: string
  deltaTone?: 'better' | 'worse' | 'neutral'
  srText?: string
  series: (number | null)[]
}

export interface MockDashboardData {
  period: 30
  kpis: {
    passRate: MockKpiMetric
    runs: MockKpiMetric
    failedCases: MockKpiMetric
    avgRunDuration: MockKpiMetric
  }
  hero: {
    rangeLabel: string
    trendPercent?: number
    trendText: string
    trendSubtitle: string
    trendDirection: 'up' | 'down' | 'equal'
    points: MockHeroPoint[]
  }
  casesPassing: RunCaseCounts & { rate: number }
  projects: (DashboardProjectRow & { lastRunText: string })[]
  recentRuns: (DashboardRecentRun & { relativeTime: string })[]
}

export interface MockChannelItem {
  id: string
  name: string
  type: 'in-app' | 'email' | 'slack' | 'discord'
  iconUrl: string
  eventTypesLabel?: string
  sent: number
  failed?: number
  unread?: number
  daily: DashboardChannelDailyPoint[]
}

export const MOCK_DASHBOARD_DATA: MockDashboardData = {
  period: 30,
  kpis: {
    passRate: {
      value: '100%',
      series: [95, 96, 98, 97, 99, 100, 100, 98, 100, 100],
    },
    runs: {
      value: '7,321',
      delta: '↑ 7,321',
      deltaTone: 'better',
      srText: 'Ejecuciones aumentaron en 7,321 vs. período anterior',
      series: [10, 12, 15, 110, 35, 80, 220, 15, 60, 15],
    },
    failedCases: {
      value: '54',
      delta: '↑ 54',
      deltaTone: 'worse',
      srText: 'Casos fallidos aumentaron en 54 vs. período anterior',
      series: [2, 2, 4, 25, 8, 15, 48, 3, 8, 2],
    },
    avgRunDuration: {
      value: '0s',
      series: [0, 2],
    },
  },
  hero: {
    rangeLabel: '24 ago – 22 sept',
    trendPercent: 12.4,
    trendText: 'Más casos ejecutados que en el período anterior',
    trendSubtitle: 'Casos ejecutados en los últimos 30 días',
    trendDirection: 'up',
    points: [
      { id: '1', label: '24 ago', current: 10, previous: 5, passed: 10, failed: 0, blocked: 0 },
      { id: '2', label: '27 ago', current: 20, previous: 5, passed: 20, failed: 0, blocked: 0 },
      { id: '3', label: '31 ago', current: 2100, previous: 10, passed: 2050, failed: 50, blocked: 0 },
      { id: '4', label: '4 sept', current: 40, previous: 10, passed: 40, failed: 0, blocked: 0 },
      { id: '5', label: '8 sept', current: 850, previous: 15, passed: 840, failed: 10, blocked: 0 },
      { id: '6', label: '11 sept', current: 2600, previous: 20, passed: 2570, failed: 30, blocked: 0 },
      { id: '7', label: '15 sept', current: 950, previous: 20, passed: 940, failed: 10, blocked: 0 },
      { id: '8', label: '18 sept', current: 5980, previous: 25, passed: 5920, failed: 60, blocked: 0 },
      { id: '9', label: '22 sept', current: 1800, previous: 25, passed: 1780, failed: 20, blocked: 0 },
    ],
  },
  casesPassing: {
    total: 154,
    pass: 142,
    fail: 12,
    skip: 4,
    blocked: 2,
    pending: 0,
    running: 0,
    rate: 91,
  },
  projects: [
    {
      id: 'proj-1',
      name: 'Checkout Web',
      suites: 3,
      cases: 40,
      passRate: 0.82,
      lastRunAt: '2026-09-22T10:00:00.000Z',
      lastRunText: 'hace 10 min',
    },
    {
      id: 'proj-2',
      name: 'API Backend',
      suites: 4,
      cases: 64,
      passRate: 0.96,
      lastRunAt: '2026-09-22T09:30:00.000Z',
      lastRunText: 'hace 35 min',
    },
    {
      id: 'proj-3',
      name: 'Mobile App',
      suites: 2,
      cases: 18,
      passRate: 0.45,
      lastRunAt: '2026-09-22T08:00:00.000Z',
      lastRunText: 'hace 1 h',
    },
    {
      id: 'proj-4',
      name: 'Billing Service',
      suites: 3,
      cases: 32,
      passRate: 0.94,
      lastRunAt: '2026-09-22T06:00:00.000Z',
      lastRunText: 'hace 3 h',
    },
  ],
  recentRuns: [
    {
      id: 'run-1',
      projectId: 'proj-1',
      projectName: 'Checkout Web',
      suiteId: 'suite-1',
      suiteName: 'Checkout',
      name: 'Regression suite',
      status: 'pass',
      source: 'github_actions',
      startedAt: '2026-09-22T10:00:00.000Z',
      commitSha: 'd2f363de80e51157947e36f40d2965404e162b21',
      commitMessage: 'fix(ci): retry throttled run reports',
      casesPassed: 12,
      casesTotal: 12,
      passRate: 1,
      relativeTime: 'hace 10 min',
    },
    {
      id: 'run-2',
      projectId: 'proj-2',
      projectName: 'API Backend',
      suiteId: 'suite-2',
      suiteName: 'Auth',
      name: 'Integration tests',
      status: 'running',
      source: 'github_actions',
      startedAt: '2026-09-22T10:08:00.000Z',
      commitSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4',
      commitMessage: 'feat(auth): add device binding',
      casesPassed: 24,
      casesTotal: 24,
      passRate: null,
      relativeTime: 'hace 2 min',
    },
    {
      id: 'run-3',
      projectId: 'proj-3',
      projectName: 'Mobile App',
      suiteId: 'suite-3',
      suiteName: 'Auth smoke',
      name: 'Smoke tests',
      status: 'fail',
      source: 'api',
      startedAt: '2026-09-22T09:25:00.000Z',
      casesPassed: 3,
      casesTotal: 5,
      passRate: 0.6,
      relativeTime: 'hace 35 min',
    },
    {
      id: 'run-4',
      projectId: 'proj-4',
      projectName: 'Billing Service',
      suiteId: 'suite-4',
      suiteName: 'Billing Ingestion',
      name: 'Ingestion pipeline',
      status: 'pass',
      source: 'manual',
      startedAt: '2026-09-22T09:00:00.000Z',
      casesPassed: 18,
      casesTotal: 18,
      passRate: 1,
      relativeTime: 'hace 1 h',
    },
  ],
}

function generate14DayStrip(
  sentPattern: number[],
  failedPattern: number[],
): DashboardChannelDailyPoint[] {
  return Array.from({ length: 14 }, (_, index) => ({
    date: `2026-09-${String(index + 9).padStart(2, '0')}`,
    sent: sentPattern[index % sentPattern.length] ?? 2,
    failed: failedPattern[index % failedPattern.length] ?? 0,
  }))
}

export const MOCK_CHANNELS: MockChannelItem[] = [
  {
    id: 'ch-in-app',
    name: 'Qably In-App',
    type: 'in-app',
    iconUrl: '/icono-qably.png',
    sent: 124,
    unread: 2,
    daily: generate14DayStrip([4, 6, 8, 5, 9, 12, 10, 8, 14, 11, 9, 13, 15, 12], [0]),
  },
  {
    id: 'ch-email',
    name: 'Gmail & Correo',
    type: 'email',
    iconUrl: '/logos/gmail.svg',
    eventTypesLabel: 'Regresión de casos, Seguridad',
    sent: 48,
    failed: 0,
    daily: generate14DayStrip([2, 3, 2, 4, 3, 5, 4, 2, 6, 4, 3, 5, 4, 3], [0]),
  },
  {
    id: 'ch-slack',
    name: 'Team Slack',
    type: 'slack',
    iconUrl: '/logos/slack.svg',
    eventTypesLabel: 'Fallos de corrida, Alertas críticas',
    sent: 86,
    failed: 2,
    daily: generate14DayStrip([5, 8, 6, 7, 9, 8, 7, 6, 10, 8, 7, 9, 8, 6], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]),
  },
  {
    id: 'ch-discord',
    name: 'Discord Webhook',
    type: 'discord',
    iconUrl: '/logos/discord.svg',
    eventTypesLabel: 'Alertas de regresión, Corridas',
    sent: 34,
    failed: 0,
    daily: generate14DayStrip([1, 2, 3, 2, 4, 3, 2, 4, 3, 2, 3, 2, 1, 2], [0]),
  },
]

export const MOCK_DEMO_USER = {
  name: 'Demo',
  initials: 'D',
} as const
