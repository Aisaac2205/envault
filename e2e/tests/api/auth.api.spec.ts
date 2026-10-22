import { expect, test } from '@playwright/test';
import { SIGNED_OUT } from '../../support/auth-state';

test.describe('authentication', () => {
  test.describe('without a session', () => {
    test.use({ storageState: SIGNED_OUT });

    test('GET /connections is rejected with the error envelope', async ({ request }) => {
      const response = await request.get('connections');
      expect(response.status()).toBe(401);

      expect(await response.json()).toEqual({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          statusCode: 401,
        },
        timestamp: expect.any(String),
        path: expect.stringContaining('/connections'),
      });
    });
  });

  test.describe('with the saved admin session', () => {
    test('GET /connections returns the data envelope', async ({ request }) => {
      const response = await request.get('connections');
      expect(response.status()).toBe(200);

      expect(await response.json()).toEqual({
        data: expect.any(Array),
        timestamp: expect.any(String),
      });
    });
  });
});
