import React, { useState } from 'react';
import {
  BellSimple,
  Play,
  Plug,
  SidebarSimple,
  TrendUp,
} from '@phosphor-icons/react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { Iphone16Pro } from '@/components/ui/iphone-16-pro';
import {
  Sparkline,
  Gauge,
  PassRateBar,
  DeliveryBars,
} from '@qably/ui/dashboard';
import { ChartContainer, type ChartConfig } from '@qably/ui/chart';
import type { DashboardPeriod, RunStatus } from '@qably/types';
import {
  MOCK_CHANNELS,
  MOCK_DASHBOARD_DATA,
  MOCK_DEMO_USER,
} from '@/features/dashboard-preview/data/mock-dashboard-data';
import type { DashboardTranslations, Locale } from '@/features/i18n/types';

interface MobileDashboardIphoneProps {
  tDashboard: DashboardTranslations;
  locale?: Locale;
}

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
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-app-canvas text-[10px] font-semibold text-app-default border border-app-border/60"
    >
      {initials}
    </span>
  );
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'github_actions') {
    return <img src="/logos/githubactions.svg" alt="" className="size-3 shrink-0" />;
  }
  if (source === 'api') {
    return <Plug size={12} weight="bold" aria-hidden="true" />;
  }
  return <Play size={12} weight="fill" aria-hidden="true" />;
}

function MobileStatusChip({
  status,
  label,
}: {
  status: RunStatus;
  label: string;
}) {
  const toneClass =
    status === 'pass'
      ? 'bg-qb-pass-bg text-qb-pass'
      : status === 'fail'
        ? 'bg-qb-fail-bg text-qb-fail'
        : status === 'running'
          ? 'bg-qb-running-bg text-qb-running'
          : 'bg-app-canvas-hover text-app-muted';

  return (
    <span
      aria-label={label}
      data-status={status}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-semibold leading-none ${toneClass}`}
    >
      {status === 'pass' && (
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z" />
        </svg>
      )}
      {status === 'fail' && (
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
        </svg>
      )}
      {status === 'running' && (
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true" className="animate-spin">
          <path d="M128,24a104,104,0,0,1,104,104h-32a72,72,0,0,0-72-72Z" />
        </svg>
      )}
      {status === 'pending' && (
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true">
          <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-88H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v40h32a8,8,0,0,1,0,16Z" />
        </svg>
      )}
      <span>{label}</span>
    </span>
  );
}

export function MobileDashboardIphone({ tDashboard }: MobileDashboardIphoneProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriod>(30);

  const heroChartConfig: ChartConfig = {
    current: { label: tDashboard.heroSeriesCurrent, color: 'var(--qb-chart-line)' },
    previous: { label: tDashboard.heroSeriesPrevious, color: 'var(--qb-chart-compare)' },
  };

  return (
    <div className="relative mx-auto flex select-none justify-center py-4">
      <div className="relative aspect-[200/400] w-[320px] drop-shadow-[0_25px_60px_rgba(0,0,0,0.85)] sm:w-[350px]">
        <Iphone16Pro className="pointer-events-none absolute inset-0 z-20 size-full" />

        <div
          className="absolute z-10 flex flex-col overflow-hidden bg-app-canvas font-sans text-app-default"
          style={{
            left: '7.04%',
            top: '3.2%',
            width: '85.99%',
            height: '93.59%',
            borderRadius: '24.62px',
          }}
        >
          {/* iOS Status Bar */}
          <div className="flex h-9 shrink-0 items-center justify-between bg-app-canvas px-5 pt-2 text-[10px] font-semibold text-app-default">
            <span>1:11 PM</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-medium tracking-tight">5G</span>
              <span className="flex h-2.5 w-4 rounded-[3px] border border-app-default p-0.5">
                <span className="h-full w-2.5 rounded-[1px] bg-app-default" />
              </span>
            </div>
          </div>

          {/* Compact Top Bar */}
          <header className="flex h-8 shrink-0 items-center justify-between border-b border-app-border/40 bg-app-canvas px-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                aria-label={tDashboard.toggleSidebar}
                className="flex size-5.5 shrink-0 items-center justify-center rounded-md border border-app-border bg-app-surface text-app-default shadow-2xs transition-colors hover:bg-app-canvas-hover"
              >
                <SidebarSimple size={12} weight="regular" aria-hidden="true" />
              </button>
              <h1 className="truncate text-[11px] font-semibold tracking-[-0.015em] text-app-default">
                {tDashboard.navDashboard}
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <span className="relative flex size-5.5 items-center justify-center rounded-md text-app-default transition-colors hover:bg-app-canvas-hover">
                <BellSimple size={13} weight="regular" aria-hidden="true" />
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 flex size-2.5 items-center justify-center rounded-full bg-[#e11d48] text-[7px] font-bold leading-none text-white shadow-xs"
                >
                  1
                </span>
              </span>

              {/* Mock User Avatar with Initials */}
              <span
                aria-label={MOCK_DEMO_USER.name}
                className="flex size-5 shrink-0 select-none items-center justify-center rounded-full bg-app-primary text-[8px] font-bold text-app-primary-fg shadow-2xs border border-app-border/40"
              >
                {MOCK_DEMO_USER.initials}
              </span>
            </div>
          </header>

          {/* Main Scrollable Content Area */}
          <main className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-none text-left">
            {/* Header Subtitle */}
            <p className="text-[10px] leading-snug text-app-muted">
              {tDashboard.headerSubtitle}
            </p>

            {/* Period Segmented Control (Pills) */}
            <div className="flex items-center gap-1.5">
              {([7, 30, 90] as const).map((period) => {
                const isSelected = selectedPeriod === period;
                const label = period === 7 ? tDashboard.period7d : period === 30 ? tDashboard.period30d : tDashboard.period90d;
                return (
                  <button
                    key={period}
                    type="button"
                    onClick={() => setSelectedPeriod(period)}
                    className={`rounded-full px-2.5 py-0.5 text-[9px] transition-all ${
                      isSelected
                        ? 'bg-app-primary text-app-primary-fg font-semibold shadow-xs border border-app-primary'
                        : 'bg-app-surface text-app-default border border-app-border font-normal hover:bg-app-canvas-hover'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* 1. 2x2 KPI Strip (compact & proportional to user screenshot) */}
            <div className="grid grid-cols-2 gap-2">
              {/* Tile 1: Pass Rate */}
              <div className="flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-2.5 shadow-2xs h-[88px]">
                <div>
                  <div className="text-base font-semibold tracking-tight text-app-default tabular-nums leading-none">
                    {MOCK_DASHBOARD_DATA.kpis.passRate.value}
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-app-muted leading-tight truncate">
                    {tDashboard.kpiPassRate}
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Sparkline
                    values={MOCK_DASHBOARD_DATA.kpis.passRate.series}
                    label={tDashboard.kpiPassRate}
                    tone="pass"
                    width={72}
                    height={22}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Tile 2: Runs */}
              <div className="flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-2.5 shadow-2xs h-[88px]">
                <div>
                  <div className="text-base font-semibold tracking-tight text-app-default tabular-nums leading-none">
                    {MOCK_DASHBOARD_DATA.kpis.runs.value}
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-app-muted leading-tight truncate">
                    {tDashboard.kpiRuns}
                  </div>
                  {MOCK_DASHBOARD_DATA.kpis.runs.delta && (
                    <div className="mt-0.5 text-[9px] font-semibold text-app-pass flex items-center gap-0.5 leading-none">
                      <span>{MOCK_DASHBOARD_DATA.kpis.runs.delta}</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end pt-1">
                  <Sparkline
                    values={MOCK_DASHBOARD_DATA.kpis.runs.series}
                    label={tDashboard.kpiRuns}
                    tone="primary"
                    width={72}
                    height={22}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Tile 3: Failed cases */}
              <div className="flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-2.5 shadow-2xs h-[88px]">
                <div>
                  <div className="text-base font-semibold tracking-tight text-app-default tabular-nums leading-none">
                    {MOCK_DASHBOARD_DATA.kpis.failedCases.value}
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-app-muted leading-tight truncate">
                    {tDashboard.kpiFailedCases}
                  </div>
                  {MOCK_DASHBOARD_DATA.kpis.failedCases.delta && (
                    <div className="mt-0.5 text-[9px] font-semibold text-app-fail flex items-center gap-0.5 leading-none">
                      <span>{MOCK_DASHBOARD_DATA.kpis.failedCases.delta}</span>
                    </div>
                  )}
                </div>
                <div className="flex justify-end pt-1">
                  <Sparkline
                    values={MOCK_DASHBOARD_DATA.kpis.failedCases.series}
                    label={tDashboard.kpiFailedCases}
                    tone="fail"
                    width={72}
                    height={22}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Tile 4: Avg duration */}
              <div className="flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-2.5 shadow-2xs h-[88px]">
                <div>
                  <div className="text-base font-semibold tracking-tight text-app-default tabular-nums leading-none">
                    {MOCK_DASHBOARD_DATA.kpis.avgRunDuration.value}
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-app-muted leading-tight truncate">
                    {tDashboard.kpiAvgDuration}
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Sparkline
                    values={MOCK_DASHBOARD_DATA.kpis.avgRunDuration.series}
                    label={tDashboard.kpiAvgDuration}
                    tone="warn"
                    width={72}
                    height={22}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            {/* 2. Hero: Casos ejecutados (identical proportions to user screenshot) */}
            <section aria-label={tDashboard.heroTitle} className="rounded-xl border border-app-border bg-app-surface p-3 shadow-2xs space-y-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-xs font-semibold tracking-tight text-app-default">
                  {tDashboard.heroTitle}
                </h2>
                <span className="text-[10px] text-app-muted">
                  {MOCK_DASHBOARD_DATA.hero.rangeLabel}
                </span>
              </div>

              <div className="h-36 w-full">
                <ChartContainer
                  config={heroChartConfig}
                  initialDimension={{ width: 250, height: 144 }}
                  className="aspect-auto h-full w-full"
                >
                  <LineChart
                    data={MOCK_DASHBOARD_DATA.hero.points}
                    margin={{ top: 8, right: 6, bottom: 0, left: -10 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--qb-chart-grid)" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={4}
                      interval="preserveStartEnd"
                      tick={{ fill: 'var(--color-app-muted)', fontSize: 8 }}
                    />
                    <YAxis
                      width={36}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => (val >= 1000 ? `${Math.round(val / 1000)} mil` : `${val}`)}
                      tick={{ fill: 'var(--color-app-muted)', fontSize: 8 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="current"
                      stroke="var(--qb-chart-line)"
                      strokeWidth={1.6}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="previous"
                      stroke="var(--qb-chart-compare)"
                      strokeWidth={1.3}
                      strokeDasharray="3 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>

              <div className="flex flex-col gap-0.5 border-t border-app-border/40 pt-2">
                <div className="flex items-center gap-1 text-[10px] font-semibold text-app-default">
                  <TrendUp size={12} weight="bold" aria-hidden="true" className="text-app-default shrink-0" />
                  <span className="truncate">{MOCK_DASHBOARD_DATA.hero.trendText}</span>
                </div>
                <span className="text-[9px] text-app-muted">
                  {MOCK_DASHBOARD_DATA.hero.trendSubtitle}
                </span>
              </div>
            </section>

            {/* 3. Projects Table */}
            <section aria-label={tDashboard.projectsTitle} className="rounded-xl border border-app-border bg-app-surface p-3 shadow-2xs space-y-2">
              <h2 className="text-xs font-semibold tracking-tight text-app-default">
                {tDashboard.projectsTitle}
              </h2>
              <div className="space-y-2 divide-y divide-app-border/40">
                {MOCK_DASHBOARD_DATA.projects.map((project) => {
                  const pct = project.passRate === null ? null : Math.round(project.passRate * 100);
                  return (
                    <div key={project.id} className="pt-2 first:pt-0 space-y-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ProjectMonogram name={project.name} />
                          <div className="min-w-0">
                            <span className="block truncate text-[10px] font-semibold text-app-default">{project.name}</span>
                            <span className="block text-[8px] text-app-muted">{project.lastRunText}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-mono text-[10px] font-semibold tabular-nums text-app-default">
                            {pct === null ? '—' : `${pct}%`}
                          </span>
                        </div>
                      </div>
                      <div className="w-full">
                        <PassRateBar value={pct} label={`${project.name} pass rate`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 4. Cases Passing Gauge */}
            <section aria-label={tDashboard.casesTitle} className="rounded-xl border border-app-border bg-app-surface p-3 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-tight text-app-default">{tDashboard.casesTitle}</h2>
                <span className="text-[9px] text-app-muted">
                  {fill(tDashboard.casesPassedOf, {
                    passed: MOCK_DASHBOARD_DATA.casesPassing.pass,
                    total: MOCK_DASHBOARD_DATA.casesPassing.total,
                  })}
                </span>
              </div>

              <div className="flex flex-col items-center justify-center py-1">
                <Gauge
                  value={MOCK_DASHBOARD_DATA.casesPassing.rate}
                  label={tDashboard.casesGaugeLabel}
                  width={130}
                  height={72}
                >
                  <span className="text-base font-semibold tracking-tight tabular-nums text-app-default">
                    {MOCK_DASHBOARD_DATA.casesPassing.rate}%
                  </span>
                </Gauge>
              </div>

              <dl className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-md border border-app-border p-1 bg-app-canvas">
                  <dt className="text-[8px] text-app-muted">{tDashboard.casesFailed}</dt>
                  <dd className="font-semibold text-app-fail tabular-nums text-[10px]">{MOCK_DASHBOARD_DATA.casesPassing.fail}</dd>
                </div>
                <div className="rounded-md border border-app-border p-1 bg-app-canvas">
                  <dt className="text-[8px] text-app-muted">{tDashboard.casesSkipped}</dt>
                  <dd className="font-semibold text-app-default tabular-nums text-[10px]">{MOCK_DASHBOARD_DATA.casesPassing.skip}</dd>
                </div>
                <div className="rounded-md border border-app-border p-1 bg-app-canvas">
                  <dt className="text-[8px] text-app-muted">{tDashboard.casesBlocked}</dt>
                  <dd className="font-semibold text-app-warn tabular-nums text-[10px]">{MOCK_DASHBOARD_DATA.casesPassing.blocked}</dd>
                </div>
              </dl>
            </section>

            {/* 5. Notification Channels */}
            <section aria-label={tDashboard.channelsTitle} className="rounded-xl border border-app-border bg-app-surface p-3 shadow-2xs space-y-2">
              <h2 className="text-xs font-semibold tracking-tight text-app-default">{tDashboard.channelsTitle}</h2>
              <div className="divide-y divide-app-border/40">
                {MOCK_CHANNELS.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between gap-1.5 py-1.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-md border border-app-border bg-app-canvas">
                        <img src={ch.iconUrl} alt="" className="size-3 object-contain" />
                      </div>
                      <span className="truncate text-[10px] font-medium text-app-default">{ch.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <DeliveryBars points={ch.daily.slice(-7)} label={ch.name} className="w-auto" />
                      <span className="font-mono text-[9px] font-medium text-app-default tabular-nums">
                        {ch.sent}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 6. Recent Activity */}
            <section aria-label={tDashboard.activityTitle} className="rounded-xl border border-app-border bg-app-surface p-3 shadow-2xs space-y-2">
              <h2 className="text-xs font-semibold tracking-tight text-app-default">{tDashboard.activityTitle}</h2>
              <div className="divide-y divide-app-border/40">
                {MOCK_DASHBOARD_DATA.recentRuns.slice(0, 3).map((run) => (
                  <div key={run.id} className="py-1.5 first:pt-0 last:pb-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="flex size-4 shrink-0 items-center justify-center rounded bg-app-canvas text-app-muted">
                          <SourceIcon source={run.source} />
                        </div>
                        <span className="truncate text-[10px] font-medium text-app-default">{run.projectName}</span>
                      </div>
                      <MobileStatusChip
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
                    </div>
                    <div className="flex items-center justify-between text-[8px] text-app-muted pl-5">
                      <span className="truncate">{run.name}</span>
                      <span className="tabular-nums shrink-0">{run.relativeTime}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
