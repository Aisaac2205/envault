import { expect, test } from '@playwright/test';
import { DIRECT_API_URL } from '../../support/env';

test.describe('stack health', () => {
  test('reports the API, its database and object storage as up', async ({ request }) => {
    // /health sits outside the /api prefix, so only the API's own port serves it.
    const response = await request.get(`${DIRECT_API_URL}/health`);
    expect(response.status()).toBe(200);

    const { data } = await response.json();
    expect(data.status).toBe('ok');
    expect(data.info.database.status).toBe('up');
    expect(data.info.r2.status).toBe('up');
  });

  // Known defect D4: the dashboard calls GET /api/health (its API client's base
  // URL is /api, apps/web/src/features/dashboard/api/dashboard-api.ts), but the
  // API excludes `health` from the global prefix, so that URL answers 404 on
  // both the proxy and the API port. This asserts what the dashboard needs.
  // When it is fixed the test passes, Playwright reports an unexpected pass and
  // fails the run: delete `fail` then.
  test.fail(
    'answers on /api/health, the path the dashboard calls',
    {
      annotation: {
        type: 'known-defect',
        description: 'D4: GET /api/health answers 404; only /health exists',
      },
    },
    async ({ request }) => {
      // Through the proxy, the way the browser reaches the API.
      const response = await request.get('health');

      expect(response.status()).toBe(200);
      const { data } = await response.json();
      expect(data.status).toBe('ok');
    },
  );
});
