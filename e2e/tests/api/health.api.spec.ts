import { expectErrorEnvelope } from '../../support/envelope';
import { BASE_URL, DIRECT_API_URL } from '../../support/env';
import { expect, test } from '../../support/fixtures';

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

  // Defect D4 was resolved by keeping health internal. /health answers without
  // authentication and reports the database and storage status, so it is served
  // only on the API's own port and is not part of the public API behind the web
  // proxy. These two tests pin that decision: publishing health later has to be
  // a deliberate change, not an accident.
  test('is not part of the public API: /api/health answers 404 with the error envelope', async ({
    anonymous,
  }) => {
    // Through the proxy, the way the browser reaches the API.
    const error = await expectErrorEnvelope(await anonymous.get('health'), 404);

    expect(error.path).toBe('/api/health');
  });

  test('is not published by the web proxy: /health serves the app, not the health report', async ({
    anonymous,
  }) => {
    const response = await anonymous.get(`${BASE_URL}/health`);

    expect(await response.text()).not.toMatch(/"database"|"r2"/);
  });
});
