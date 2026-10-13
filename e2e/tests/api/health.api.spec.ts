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
});
