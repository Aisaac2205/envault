import type { Page } from '@playwright/test';

/**
 * Answers `GET /api/<path>` with a canned body in the API's `{ data, timestamp }`
 * envelope, for screens that must be shown in a state the shared stack cannot
 * promise (for example "no connections" while other specs create some). Other
 * methods on the same path, such as the `POST` of a form, still reach the API.
 */
export async function mockApiGet(page: Page, path: string, data: unknown): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/${path}`,
    (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      return route.fulfill({ json: { data, timestamp: new Date().toISOString() } });
    },
  );
}
