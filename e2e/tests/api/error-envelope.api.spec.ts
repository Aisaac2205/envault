import { expectErrorEnvelope, expectSuccessEnvelope } from '../../support/envelope';
import { expect, test } from '../../support/fixtures';

// One shape for every outcome, so a client can handle errors in one place:
//   success  { data, timestamp }
//   failure  { error: { code, message, statusCode }, timestamp, path }
// Better Auth routes (/auth/*) are the documented exception and are covered in
// sign-in.api.spec.ts. 401 and 403 are also checked per endpoint in
// authorization.api.spec.ts; they are repeated here so this file is the whole
// statement of the contract.

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

// Resources that expose a read by id.
const BY_ID = ['connections', 'backups', 'restores', 'jobs/backups', 'jobs/restores', 'audit'];

test.describe('success bodies', () => {
  test('wrap a list in data and timestamp', async ({ request }) => {
    const data = await expectSuccessEnvelope(await request.get('connections'));

    expect(Array.isArray(data)).toBe(true);
  });

  test('wrap an object in data and timestamp', async ({ request }) => {
    const data = await expectSuccessEnvelope(await request.get('jobs/summary'));

    expect(data).toEqual(expect.any(Object));
  });

  test('wrap a created resource, with status 201', async ({ createConnection }) => {
    const { response } = await createConnection();

    await expectSuccessEnvelope(response, 201);
  });
});

test.describe('400 bad request', () => {
  test('for a body that fails validation', async ({ request }) => {
    const error = await expectErrorEnvelope(
      await request.post('connections', { data: { name: '' } }),
      400,
    );

    expect(error.path).toBe('/api/connections');
  });

  test('for a query that fails validation', async ({ request }) => {
    await expectErrorEnvelope(await request.get('jobs/analytics/daily?window=8'), 400);
  });

  test('for a body that is not JSON', async ({ request }) => {
    const response = await request.post('connections', {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not json',
    });

    await expectErrorEnvelope(response, 400);
  });
});

test.describe('401 and 403', () => {
  test('401 when there is no session', async ({ anonymous }) => {
    await expectErrorEnvelope(await anonymous.get('connections'), 401);
  });

  test('403 when the user is not an admin', async ({ nonAdmin }) => {
    await expectErrorEnvelope(await nonAdmin.get('connections'), 403);
  });
});

test.describe('404 not found', () => {
  test('for an unknown route', async ({ request }) => {
    await expectErrorEnvelope(await request.get('unknown-route'), 404);
  });

  test('for an unknown route, signed out', async ({ anonymous }) => {
    await expectErrorEnvelope(await anonymous.get('unknown-route'), 404);
  });

  test('for a method a route does not have', async ({ request }) => {
    await expectErrorEnvelope(await request.put('connections', { data: {} }), 404);
  });

  test('for a path below a real resource', async ({ request }) => {
    await expectErrorEnvelope(await request.get(`connections/${UNKNOWN_ID}/unknown`), 404);
  });

  for (const resource of BY_ID) {
    test(`for an unknown id in /${resource}`, async ({ request }) => {
      await expectErrorEnvelope(await request.get(`${resource}/${UNKNOWN_ID}`), 404);
    });
  }
});

// Known defect D7: an id that is not a UUID reaches the database, which rejects
// it, and the API answers 500 "Internal server error" for what is a client
// mistake. No path parameter is validated (no ParseUUIDPipe). The contract is a
// 4xx envelope: 404 as for any unknown id, or 400. Remove `fail` once it is fixed.
test.describe('an id that is not a UUID', () => {
  for (const resource of BY_ID) {
    test.fail(
      `answers 4xx for /${resource}/<id>`,
      {
        annotation: {
          type: 'known-defect',
          description: `D7: GET /${resource}/not-a-uuid answers 500 instead of a 4xx`,
        },
      },
      async ({ request }) => {
        const response = await request.get(`${resource}/not-a-uuid`);

        expect([400, 404]).toContain(response.status());
        await expectErrorEnvelope(response, response.status());
      },
    );
  }
});
