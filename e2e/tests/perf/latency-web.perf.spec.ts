import type { Browser, Locator, Page } from '@playwright/test';
import { AUTH_STATE_FILE, SIGNED_OUT } from '../../support/auth-state';
import { BASE_URL } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { ConnectionsPage } from '../../support/pages/connections-page';
import { DashboardPage } from '../../support/pages/dashboard-page';
import { LoginPage } from '../../support/pages/login-page';
import { readPerfConfig } from '../../support/perf/config';
import { CaseRecorder } from '../../support/perf/results';
import { progress } from '../../support/perf/runs';

// Front-end timings of three screens in Chromium, over cold loads: every load
// gets a browser context of its own, so the HTTP cache is empty and nothing is
// shared with the previous load. The first load of each page is a warm-up (the
// browser process, the connection to nginx) and is left out of the statistics.
//
// What is read from the page itself, after it has settled:
//   TTFB                navigation entry `responseStart`
//   DOMContentLoaded    navigation entry `domContentLoadedEventEnd`
//   load                navigation entry `loadEventEnd`
//   FCP / LCP           `paint` and `largest-contentful-paint` performance entries
//   transfer size       `transferSize` of the document and every resource it fetched
//                       (the app's own API calls included), which is what crossed the
//                       network, compressed as nginx sent it
//
// The login page runs at a viewport narrower than 1024 px. From 1024 px it paints
// an animated WebGL panel that headless Chromium draws in software, which can
// dominate the numbers; that case is measured too, apart and clearly labelled.
//
// Like the API latency spec, it runs after the backup and restore specs, so the
// dashboard shows a system with job history instead of an empty one.

const { frontend } = readPerfConfig();

interface PageCase {
  id: string;
  title: string;
  path: string;
  signedIn: boolean;
  viewport: { width: number; height: number };
  loads: number;
  /** What tells that the screen has rendered. */
  ready: (page: Page) => Locator;
}

const DESKTOP = { width: 1280, height: 720 };

const PAGES: PageCase[] = [
  {
    id: 'login',
    title: 'Login',
    path: '/login',
    signedIn: false,
    viewport: { width: 1000, height: 800 },
    loads: frontend.loads,
    ready: (page) => new LoginPage(page).heading,
  },
  {
    id: 'login-wide',
    title: 'Login (WebGL panel)',
    path: '/login',
    signedIn: false,
    viewport: DESKTOP,
    loads: frontend.wideLoads,
    ready: (page) => new LoginPage(page).heading,
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    path: '/',
    signedIn: true,
    viewport: DESKTOP,
    loads: frontend.loads,
    ready: (page) => new DashboardPage(page).heading,
  },
  {
    id: 'connections',
    title: 'Connections',
    path: '/connections',
    signedIn: true,
    viewport: DESKTOP,
    loads: frontend.loads,
    ready: (page) => new ConnectionsPage(page).heading,
  },
];

interface Vitals {
  ttfbMs: number;
  domContentLoadedMs: number;
  loadMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  transferBytes: number;
  requestsCount: number;
}

// Both functions run inside the page, so they cannot use anything from this module.

/** Installed before the page's own scripts: keeps the latest FCP and LCP entries. */
function observeVitals(): void {
  const vitals: { fcp: number | null; lcp: number | null } = { fcp: null, lcp: null };
  (window as unknown as { __perfVitals: typeof vitals }).__perfVitals = vitals;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        vitals.fcp = entry.startTime;
      }
    }
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      vitals.lcp = entry.startTime;
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
}

function readVitals(): Vitals {
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const { fcp, lcp } = (window as unknown as { __perfVitals: { fcp: number | null; lcp: number | null } }).__perfVitals;
  return {
    ttfbMs: navigation.responseStart,
    domContentLoadedMs: navigation.domContentLoadedEventEnd,
    loadMs: navigation.loadEventEnd,
    fcpMs: fcp,
    lcpMs: lcp,
    transferBytes: navigation.transferSize + resources.reduce((sum, entry) => sum + entry.transferSize, 0),
    requestsCount: 1 + resources.length,
  };
}

async function coldLoad(browser: Browser, spec: PageCase): Promise<Vitals> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: spec.viewport,
    storageState: spec.signedIn ? AUTH_STATE_FILE : SIGNED_OUT,
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(observeVitals);
    const response = await page.goto(spec.path, { waitUntil: 'load' });
    expect(response?.status(), `HTTP status of ${spec.path}`).toBe(200);
    // A signed-in screen that lands on the login page means the saved session is no longer valid.
    expect(new URL(page.url()).pathname, 'the page the load ended on').toBe(spec.path);
    await expect(spec.ready(page)).toBeVisible();
    // The screens fetch their data after the first paint; wait for that to finish.
    await page.waitForLoadState('networkidle');

    const vitals = await page.evaluate(readVitals);
    expect(vitals.fcpMs, 'first contentful paint').not.toBeNull();
    expect(vitals.lcpMs, 'largest contentful paint').not.toBeNull();
    return vitals;
  } finally {
    await context.close();
  }
}

test.describe('front-end cold loads', () => {
  for (const spec of PAGES) {
    test(`${spec.title}, ${spec.viewport.width}x${spec.viewport.height}, ${spec.loads} loads`, async ({ browser }) => {
      test.setTimeout(60_000 + (spec.loads + 1) * 60_000);

      const recorder = new CaseRecorder({
        group: 'frontend',
        id: spec.id,
        labels: { page: spec.title, viewport: `${spec.viewport.width}x${spec.viewport.height}` },
        meta: { browserVersion: `Chromium ${browser.version()}`, path: spec.path, signedIn: spec.signedIn },
      });

      for (let run = 0; run <= spec.loads; run++) {
        const vitals = await coldLoad(browser, spec);
        recorder.add({
          run,
          warmup: run === 0,
          metrics: {
            ttfbMs: vitals.ttfbMs,
            domContentLoadedMs: vitals.domContentLoadedMs,
            loadMs: vitals.loadMs,
            fcpMs: vitals.fcpMs!,
            lcpMs: vitals.lcpMs!,
            transferBytes: vitals.transferBytes,
            requestsCount: vitals.requestsCount,
          },
        });
        progress(
          `${spec.id} ${run === 0 ? 'warm-up' : `load ${run}/${spec.loads}`}: ` +
            `TTFB ${vitals.ttfbMs.toFixed(0)} ms, FCP ${vitals.fcpMs!.toFixed(0)} ms, ` +
            `LCP ${vitals.lcpMs!.toFixed(0)} ms, load ${vitals.loadMs.toFixed(0)} ms`,
        );
      }
      recorder.finish();
    });
  }
});
