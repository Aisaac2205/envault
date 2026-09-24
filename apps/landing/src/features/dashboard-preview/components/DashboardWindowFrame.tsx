import React, { useState } from 'react';
import {
  BellSimple,
  CaretUpDown,
  FolderSimple,
  GearSix,
  LockSimple,
  Play,
  Plug,
  SidebarSimple,
  SquaresFour,
  Tray,
  TrendUp,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  KpiTile,
  Sparkline,
  Gauge,
  PassRateBar,
  DeliveryBars,
  StatusChip,
} from '@qably/ui/dashboard';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@qably/ui/chart';
import type { DashboardPeriod } from '@qably/types';
import {
  MOCK_CHANNELS,
  MOCK_DASHBOARD_DATA,
  MOCK_DEMO_USER,
  type MockHeroPoint,
} from '../data/mock-dashboard-data';
import type { DashboardTranslations, HeroTranslations, Locale } from '../../i18n/types';

interface DashboardWindowFrameProps {
  tDashboard: DashboardTranslations;
  tHero: HeroTranslations;
  locale?: Locale;
}

type NavSection = 'dashboard' | 'projects' | 'review-inbox' | 'notifications' | 'settings';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{${key}}`).join(String(value)),
    template,
  );
}

function ProjectMonogram({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length === 0
      ? ''
      : words.length === 1
        ? words[0].slice(0, 1).toUpperCase()
        : `${words[0].slice(0, 1)}${words[1].slice(0, 1)}`.toUpperCase();

  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-app-canvas-hover text-xs font-semibold text-app-default"
    >
      {initials}
    </span>
  );
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'github_actions') {
    return <img src="/logos/githubactions.svg" alt="" className="size-4 shrink-0" />;
  }
  if (source === 'api') {
    return <Plug size={16} weight="bold" aria-hidden="true" />;
  }
  return <Play size={16} weight="fill" aria-hidden="true" />;
}

function HeroTooltipContent({
  active,
  point,
  seriesLabels,
}: {
  active?: boolean;
  point?: MockHeroPoint;
  seriesLabels: { current: string; previous: string };
}) {
  if (!active || !point) return null;

  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-qb-border/50 bg-qb-surface px-2.5 py-1.5 text-xs shadow-qb-pop">
      <div className="font-medium text-qb-fg">{point.label}</div>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px] bg-app-primary"
          />
          <div className="flex flex-1 items-center justify-between gap-4">
            <span className="text-qb-muted">{seriesLabels.current}</span>
            <span className="font-mono font-medium tabular-nums text-qb-fg">{point.current}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0 w-2.5 shrink-0 border-t-2 border-dashed border-app-muted"
          />
          <div className="flex flex-1 items-center justify-between gap-4">
            <span className="text-qb-muted">{seriesLabels.previous}</span>
            <span className="font-mono font-medium tabular-nums text-qb-fg">{point.previous}</span>
          </div>
        </div>
      </div>
      <div className="grid gap-1 border-t border-qb-border/40 pt-1.5 text-[11px] text-qb-muted">
        <div className="flex items-center justify-between gap-4">
          <span>Aprobados</span>
          <span className="font-mono tabular-nums text-qb-fg">{point.passed}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Fallidos</span>
          <span className="font-mono tabular-nums text-qb-fg">{point.failed}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Bloqueados</span>
          <span className="font-mono tabular-nums text-qb-fg">{point.blocked}</span>
        </div>
      </div>
    </div>
  );
}

export function DashboardWindowFrame({ tDashboard }: DashboardWindowFrameProps) {
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod>(30);

  const navItems: { id: NavSection; label: string; icon: Icon }[] = [
    { id: 'dashboard', label: tDashboard.navDashboard, icon: SquaresFour },
    { id: 'projects', label: tDashboard.navProjects, icon: FolderSimple },
    { id: 'review-inbox', label: tDashboard.navReviewInbox, icon: Tray },
    { id: 'notifications', label: tDashboard.navNotifications, icon: BellSimple },
    { id: 'settings', label: tDashboard.navSettings, icon: GearSix },
  ];

  const seriesLabels = {
    current: tDashboard.heroSeriesCurrent,
    previous: tDashboard.heroSeriesPrevious,
  };

  const heroChartConfig: ChartConfig = {
    current: { label: seriesLabels.current, color: 'var(--qb-chart-line)' },
    previous: { label: seriesLabels.previous, color: 'var(--qb-chart-compare)' },
  };

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-app-border-sidebar bg-app-sidebar font-sans text-app-default shadow-[0_25px_80px_rgba(0,0,0,0.85)]">
      {/* Browser chrome — top window bar with domain pill */}
      <div className="flex select-none items-center justify-between border-b border-app-border-sidebar bg-app-canvas px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#ff5f56]" aria-hidden="true" />
          <span className="size-3 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
          <span className="size-3 rounded-full bg-[#27c93f]" aria-hidden="true" />
        </div>

        <div className="flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface px-3 py-1 text-[11px] font-medium text-app-muted">
          <LockSimple size={12} weight="bold" aria-hidden="true" />
          <span>qably.dev/dashboard</span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-medium text-app-muted">
          <span className="size-2 rounded-full bg-app-pass" aria-hidden="true" />
          <span className="hidden sm:inline">Live</span>
        </div>
      </div>

      {/* Product AppShell: Sidebar + Main Content Inset */}
      <div className="grid min-w-0 grid-cols-[13rem_minmax(0,1fr)] bg-app-sidebar text-left">
        <aside className="flex min-h-0 flex-col bg-app-sidebar text-app-sidebar-fg">
          <div className="flex h-14 flex-col justify-center p-2">
            <div className="flex h-10 w-full items-center justify-between gap-1.5 px-0.5">
              <span className="flex h-10 flex-1 items-center rounded-lg px-2 transition-colors hover:bg-app-sidebar-hover">
                <img src="/qably-sidebar.svg" alt="Qably" className="h-7 w-auto translate-y-0.5 object-contain" />
              </span>
              <button
                type="button"
                aria-label={tDashboard.toggleSidebar}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-app-sidebar-fg transition-colors hover:bg-app-surface-hover hover:text-app-default"
              >
                <SidebarSimple size={20} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>

          <nav aria-label="Sidebar preview" className="flex min-h-0 flex-1 flex-col p-2">
            <ul className="flex w-full min-w-0 flex-col gap-0">
              {navItems.map((item) => {
                const isActive = activeNav === item.id;
                return (
                  <li key={item.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setActiveNav(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-app-sidebar-active font-normal text-app-sidebar-fg'
                          : 'text-app-sidebar-fg hover:bg-app-sidebar-active'
                      }`}
                    >
                      <item.icon size={16} aria-hidden="true" className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex flex-col gap-2 p-2">
            <span className="flex h-12 w-full items-center gap-2.5 rounded-xl border border-app-border-sidebar bg-app-sidebar/50 px-3 py-2 text-left">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-app-primary text-xs font-semibold text-app-primary-fg"
              >
                {MOCK_DEMO_USER.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-tight text-app-sidebar-fg">{MOCK_DEMO_USER.name}</span>
                <span className="block truncate text-xs leading-normal text-app-sidebar-fg-muted">{tDashboard.accountRole}</span>
              </span>
              <CaretUpDown size={16} aria-hidden="true" className="shrink-0 text-app-sidebar-fg-muted" />
            </span>
          </div>
        </aside>

        {/* Right inset: App Header + Dashboard Canvas */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-app-sidebar">
          <header className="flex h-14 shrink-0 items-center justify-between bg-app-sidebar px-4 md:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <h1 className="text-base font-semibold tracking-[-0.015em] text-app-default md:text-lg">{tDashboard.navDashboard}</h1>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="relative flex size-8 items-center justify-center rounded-lg text-app-default transition-colors hover:bg-app-surface-hover">
                <BellSimple size={18} aria-hidden="true" />
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 min-w-4 rounded-full bg-app-fail px-1 text-center text-[10px] font-semibold leading-4 text-app-primary-fg"
                >
                  2
                </span>
              </span>

              <span className="flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-app-primary text-xs font-bold text-app-primary-fg">
                {MOCK_DEMO_USER.initials}
              </span>
            </div>
          </header>

          <main className="@container m-3 mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl bg-app-surface shadow-app-pop ring-1 ring-app-border">
            <section
              aria-label="Dashboard"
              className="w-full space-y-5 px-4 py-5 text-app-default @md:space-y-6 @md:px-6 @2xl:px-8"
            >
              {/* Dashboard Header: Subtitle & Period Toggle */}
              <div className="mx-auto flex w-full max-w-dashboard flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-2xl text-xs text-app-muted sm:text-sm">{tDashboard.headerSubtitle}</p>
                <div className="flex shrink-0 items-center rounded-lg border border-app-border bg-app-canvas p-0.5 text-xs font-medium">
                  {([7, 30, 90] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setSelectedPeriod(period)}
                      className={`rounded-md px-2.5 py-1 transition-colors ${
                        selectedPeriod === period
                          ? 'bg-app-surface font-semibold text-app-default shadow-xs'
                          : 'text-app-muted hover:text-app-default'
                      }`}
                    >
                      {period === 7 ? tDashboard.period7d : period === 30 ? tDashboard.period30d : tDashboard.period90d}
                    </button>
                  ))}
                </div>
              </div>

              {/* 1. KPI Strip: 4 KpiTiles with Sparklines */}
              <section aria-label="KPI overview" className="mx-auto min-w-0 w-full max-w-dashboard">
                <dl className="grid grid-cols-1 gap-3 @xs:grid-cols-2 @2xl:grid-cols-4">
                  {/* Pass rate */}
                  <KpiTile
                    label={tDashboard.kpiPassRate}
                    value={MOCK_DASHBOARD_DATA.kpis.passRate.value}
                    delta={
                      MOCK_DASHBOARD_DATA.kpis.passRate.delta && MOCK_DASHBOARD_DATA.kpis.passRate.deltaTone
                        ? {
                            text: MOCK_DASHBOARD_DATA.kpis.passRate.delta,
                            tone: MOCK_DASHBOARD_DATA.kpis.passRate.deltaTone,
                            srText: MOCK_DASHBOARD_DATA.kpis.passRate.srText ?? '',
                          }
                        : undefined
                    }
                  >
                    <Sparkline
                      values={MOCK_DASHBOARD_DATA.kpis.passRate.series}
                      label={tDashboard.kpiPassRate}
                      tone="pass"
                    />
                  </KpiTile>

                  {/* Runs */}
                  <KpiTile
                    label={tDashboard.kpiRuns}
                    value={MOCK_DASHBOARD_DATA.kpis.runs.value}
                    delta={
                      MOCK_DASHBOARD_DATA.kpis.runs.delta && MOCK_DASHBOARD_DATA.kpis.runs.deltaTone
                        ? {
                            text: MOCK_DASHBOARD_DATA.kpis.runs.delta,
                            tone: MOCK_DASHBOARD_DATA.kpis.runs.deltaTone,
                            srText: MOCK_DASHBOARD_DATA.kpis.runs.srText ?? '',
                          }
                        : undefined
                    }
                  >
                    <Sparkline
                      values={MOCK_DASHBOARD_DATA.kpis.runs.series}
                      label={tDashboard.kpiRuns}
                      tone="primary"
                    />
                  </KpiTile>

                  {/* Failed Cases */}
                  <KpiTile
                    label={tDashboard.kpiFailedCases}
                    value={MOCK_DASHBOARD_DATA.kpis.failedCases.value}
                    delta={
                      MOCK_DASHBOARD_DATA.kpis.failedCases.delta && MOCK_DASHBOARD_DATA.kpis.failedCases.deltaTone
                        ? {
                            text: MOCK_DASHBOARD_DATA.kpis.failedCases.delta,
                            tone: MOCK_DASHBOARD_DATA.kpis.failedCases.deltaTone,
                            srText: MOCK_DASHBOARD_DATA.kpis.failedCases.srText ?? '',
                          }
                        : undefined
                    }
                  >
                    <Sparkline
                      values={MOCK_DASHBOARD_DATA.kpis.failedCases.series}
                      label={tDashboard.kpiFailedCases}
                      tone="fail"
                    />
                  </KpiTile>

                  {/* Avg Run Duration */}
                  <KpiTile
                    label={tDashboard.kpiAvgDuration}
                    value={MOCK_DASHBOARD_DATA.kpis.avgRunDuration.value}
                    delta={
                      MOCK_DASHBOARD_DATA.kpis.avgRunDuration.delta && MOCK_DASHBOARD_DATA.kpis.avgRunDuration.deltaTone
                        ? {
                            text: MOCK_DASHBOARD_DATA.kpis.avgRunDuration.delta,
                            tone: MOCK_DASHBOARD_DATA.kpis.avgRunDuration.deltaTone,
                            srText: MOCK_DASHBOARD_DATA.kpis.avgRunDuration.srText ?? '',
                          }
                        : undefined
                    }
                  >
                    <Sparkline
                      values={MOCK_DASHBOARD_DATA.kpis.avgRunDuration.series}
                      label={tDashboard.kpiAvgDuration}
                      tone="warn"
                    />
                  </KpiTile>
                </dl>
              </section>

              {/* 2. Hero: Executed Cases Comparison Chart */}
              <section aria-label={tDashboard.heroTitle} className="mx-auto w-full max-w-dashboard">
                <div className="flex flex-col rounded-xl border border-app-border bg-app-surface shadow-app-card">
                  <div className="flex flex-col gap-0.5 p-4 pb-2 sm:p-5 sm:pb-3">
                    <h2 className="text-sm font-semibold text-app-default sm:text-base">{tDashboard.heroTitle}</h2>
                    <span className="text-xs text-app-muted">{MOCK_DASHBOARD_DATA.hero.rangeLabel}</span>
                  </div>

                  <div className="h-56 min-h-[224px] min-w-0 px-2 sm:h-64 sm:min-h-[256px] sm:px-4">
                    <ChartContainer
                      config={heroChartConfig}
                      initialDimension={{ width: 640, height: 224 }}
                      className="aspect-auto h-full w-full min-h-[200px] min-w-0"
                      style={{ minHeight: 200, minWidth: 0 }}
                    >
                      <LineChart
                        data={MOCK_DASHBOARD_DATA.hero.points}
                        margin={{ top: 12, right: 12, bottom: 0, left: 0 }}
                      >
                        <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--qb-chart-grid)" />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          tick={{ fill: 'var(--color-app-muted)', fontSize: 11 }}
                        />
                        <YAxis
                          width={36}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fill: 'var(--color-app-muted)', fontSize: 11 }}
                        />
                        <ChartTooltip
                          cursor={{ stroke: 'var(--qb-chart-line)', strokeOpacity: 0.18, strokeWidth: 1 }}
                          content={(props) => (
                            <HeroTooltipContent
                              active={props.active}
                              point={props.payload?.[0]?.payload as MockHeroPoint | undefined}
                              seriesLabels={seriesLabels}
                            />
                          )}
                        />
                        <Line
                          type="monotone"
                          dataKey="current"
                          stroke="var(--qb-chart-line)"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                          activeDot={{ r: 4, stroke: 'var(--qb-chart-line)', strokeWidth: 2, className: 'fill-app-surface' }}
                        />
                        <Line
                          type="monotone"
                          dataKey="previous"
                          stroke="var(--qb-chart-compare)"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          isAnimationActive={false}
                          activeDot={{ r: 3, fill: 'var(--qb-chart-compare)', className: 'stroke-app-surface' }}
                        />
                      </LineChart>
                    </ChartContainer>
                  </div>

                  <div className="flex flex-col items-start gap-0.5 border-t border-app-border/40 p-4 pt-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-app-default">
                      <TrendUp size={15} weight="bold" aria-hidden="true" className="text-app-pass" />
                      {fill(tDashboard.heroTrendText, {
                        percent: MOCK_DASHBOARD_DATA.hero.trendPercent ?? 0,
                        count: selectedPeriod,
                      })}
                    </span>
                    <span className="text-[11px] text-app-muted">{tDashboard.heroTrendSubtitle}</span>
                  </div>
                </div>
              </section>

              {/* 3. Row 1: Projects Table + Cases Passing Gauge */}
              <div className="mx-auto w-full max-w-dashboard @container">
                <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-3 @md:gap-6">
                  {/* Projects Table (@3xl:col-span-2) */}
                  <section
                    aria-label={tDashboard.projectsTitle}
                    className="min-w-0 @3xl:col-span-2 flex flex-col justify-between rounded-xl border border-app-border bg-app-surface shadow-app-card"
                  >
                    <div className="flex items-center justify-between p-4 pb-3 sm:p-5 sm:pb-4">
                      <h2 className="text-sm font-semibold text-app-default sm:text-base">{tDashboard.projectsTitle}</h2>
                    </div>

                    <div className="flex-1 overflow-x-auto pb-3">
                      <table className="w-full min-w-[440px] border-collapse text-left">
                        <thead>
                          <tr className="border-b border-app-border bg-app-canvas/40">
                            <th scope="col" className="py-2.5 pl-4 pr-3 text-xs font-medium text-app-muted sm:pl-5">
                              {tDashboard.thProject}
                            </th>
                            <th scope="col" className="py-2.5 px-3 text-center text-xs font-medium text-app-muted">
                              {tDashboard.thSuites}
                            </th>
                            <th scope="col" className="py-2.5 px-3 text-center text-xs font-medium text-app-muted">
                              {tDashboard.thCases}
                            </th>
                            <th scope="col" className="py-2.5 pl-3 pr-4 text-right text-xs font-medium text-app-muted sm:pr-5">
                              {tDashboard.thPassRate}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-app-border/60">
                          {MOCK_DASHBOARD_DATA.projects.map((project) => {
                            const pct = project.passRate === null ? null : Math.round(project.passRate * 100);
                            return (
                              <tr key={project.id} className="transition-colors hover:bg-app-canvas/20">
                                <td className="py-3 pl-4 pr-3 sm:pl-5">
                                  <div className="flex min-w-0 items-center gap-2.5">
                                    <ProjectMonogram name={project.name} />
                                    <div className="min-w-0">
                                      <span className="block truncate text-xs font-semibold text-app-default">
                                        {project.name}
                                      </span>
                                      <span className="block text-[11px] text-app-muted">{project.lastRunText}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-xs font-medium text-app-default tabular-nums">
                                  {project.suites}
                                </td>
                                <td className="py-3 px-3 text-center font-mono text-xs font-medium text-app-default tabular-nums">
                                  {project.cases}
                                </td>
                                <td className="py-3 pl-3 pr-4 sm:pr-5">
                                  <div className="flex items-center justify-end gap-2.5">
                                    <div className="w-24">
                                      <PassRateBar value={pct} label={`${project.name} pass rate`} />
                                    </div>
                                    <span className="w-10 text-right font-mono text-xs font-semibold text-app-default tabular-nums">
                                      {pct === null ? '—' : `${pct}%`}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Cases Gauge Card (col-span-1) */}
                  <section
                    aria-label={tDashboard.casesTitle}
                    className="min-w-0 flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-4 shadow-app-card sm:p-5"
                  >
                    <h2 className="text-sm font-semibold text-app-default sm:text-base">{tDashboard.casesTitle}</h2>

                    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
                      <Gauge
                        value={MOCK_DASHBOARD_DATA.casesPassing.rate}
                        label={tDashboard.casesGaugeLabel}
                        width={200}
                        height={115}
                      >
                        <span className="text-2xl font-medium tracking-tight tabular-nums text-app-default">
                          {MOCK_DASHBOARD_DATA.casesPassing.rate}%
                        </span>
                      </Gauge>

                      <p className="font-mono text-xs font-medium text-app-default tabular-nums">
                        {fill(tDashboard.casesPassedOf, {
                          passed: MOCK_DASHBOARD_DATA.casesPassing.pass,
                          total: MOCK_DASHBOARD_DATA.casesPassing.total,
                        })}
                      </p>

                      <dl className="grid w-full grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-lg border border-app-border p-2">
                          <dt className="text-[11px] text-app-muted">{tDashboard.casesFailed}</dt>
                          <dd className="font-semibold text-app-fail tabular-nums">
                            {MOCK_DASHBOARD_DATA.casesPassing.fail}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-app-border p-2">
                          <dt className="text-[11px] text-app-muted">{tDashboard.casesSkipped}</dt>
                          <dd className="font-semibold text-app-default tabular-nums">
                            {MOCK_DASHBOARD_DATA.casesPassing.skip}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-app-border p-2">
                          <dt className="text-[11px] text-app-muted">{tDashboard.casesBlocked}</dt>
                          <dd className="font-semibold text-app-warn tabular-nums">
                            {MOCK_DASHBOARD_DATA.casesPassing.blocked}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </section>
                </div>
              </div>

              {/* 4. Row 2: Channels Card + Recent Activity */}
              <div className="mx-auto w-full max-w-dashboard @container">
                <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2 @md:gap-6">
                  {/* Channels Card */}
                  <section
                    aria-label={tDashboard.channelsTitle}
                    className="min-w-0 flex flex-col rounded-xl border border-app-border bg-app-surface shadow-app-card"
                  >
                    <div className="flex items-center justify-between p-4 pb-2 sm:p-5 sm:pb-3">
                      <h2 className="text-sm font-semibold text-app-default sm:text-base">{tDashboard.channelsTitle}</h2>
                    </div>

                    <div className="flex flex-col divide-y divide-app-border/60">
                      {MOCK_CHANNELS.map((ch) => (
                        <div
                          key={ch.id}
                          className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-app-border bg-app-surface-raised">
                              <img src={ch.iconUrl} alt="" className="size-4.5 object-contain" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-app-default">{ch.name}</p>
                              {ch.eventTypesLabel && (
                                <p className="truncate text-[11px] text-app-muted">{ch.eventTypesLabel}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-3 self-end sm:self-auto">
                            <DeliveryBars
                              points={ch.daily}
                              label={fill(tDashboard.channelsDeliveryLabel, { name: ch.name })}
                              className="w-24"
                            />
                            <div className="flex w-20 flex-col items-end gap-0.5 tabular-nums">
                              <span className="font-mono text-xs font-medium text-app-default">
                                {fill(tDashboard.channelsSentCount, { count: ch.sent })}
                              </span>
                              {ch.unread !== undefined ? (
                                <span className="font-mono text-[10px] text-app-muted">
                                  {fill(tDashboard.channelsUnreadCount, { count: ch.unread })}
                                </span>
                              ) : ch.failed !== undefined ? (
                                <span
                                  className={`font-mono text-[10px] ${
                                    ch.failed > 0 ? 'text-app-fail' : 'text-app-pass'
                                  }`}
                                >
                                  {fill(tDashboard.channelsFailedCount, { count: ch.failed })}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Activity Card */}
                  <section
                    aria-label={tDashboard.activityTitle}
                    className="min-w-0 flex flex-col rounded-xl border border-app-border bg-app-surface shadow-app-card"
                  >
                    <div className="flex items-center justify-between p-4 pb-2 sm:p-5 sm:pb-3">
                      <h2 className="text-sm font-semibold text-app-default sm:text-base">{tDashboard.activityTitle}</h2>
                    </div>

                    <div className="flex flex-col divide-y divide-app-border/60 px-4 pb-2 sm:px-5">
                      {MOCK_DASHBOARD_DATA.recentRuns.map((run) => (
                        <div key={run.id} className="flex min-w-0 items-start gap-2.5 py-3">
                          <div
                            role="img"
                            aria-label={run.source}
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-app-canvas text-app-muted"
                          >
                            <SourceIcon source={run.source} />
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-xs font-medium text-app-default">
                                <span>{run.projectName}</span>
                                <span className="text-app-muted"> · </span>
                                <span className="text-app-muted">{run.name}</span>
                              </p>
                              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                                <StatusChip
                                  status={run.status}
                                  label={
                                    run.status === 'pass'
                                      ? tDashboard.statusPass
                                      : run.status === 'fail'
                                        ? tDashboard.statusFail
                                        : run.status === 'running'
                                          ? tDashboard.statusRunning
                                          : tDashboard.statusBlocked
                                  }
                                />
                                <span className="text-[11px] text-app-muted tabular-nums">{run.relativeTime}</span>
                              </div>
                            </div>

                            {run.commitSha && (
                              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-app-muted">
                                <img src="/logos/github.svg" alt="" className="size-3 shrink-0 opacity-70" />
                                <span className="shrink-0 font-mono text-app-default">
                                  {run.commitSha.slice(0, 7)}
                                </span>
                                {run.commitMessage && (
                                  <span className="min-w-0 truncate">{run.commitMessage}</span>
                                )}
                              </div>
                            )}

                            <span className="text-[11px] text-app-muted tabular-nums">
                              {fill(tDashboard.activityPassedOf, {
                                passed: run.casesPassed,
                                total: run.casesTotal,
                              })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
