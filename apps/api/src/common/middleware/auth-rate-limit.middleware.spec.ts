import { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import express from 'express';
import {
  AuthRateLimitStore,
  createAuthRateLimitMiddleware,
} from './auth-rate-limit.middleware';

describe('AuthRateLimitStore', () => {
  let now: number;

  beforeEach(() => {
    now = 1_000;
  });

  it('blocks requests beyond the limit and reports when the window resets', () => {
    const store = new AuthRateLimitStore({
      maxRequests: 2,
      maxKeys: 100,
      sweepIntervalMs: 1_000,
      windowMs: 60_000,
      now: () => now,
    });

    expect(store.consume('203.0.113.10')).toEqual({ allowed: true });
    expect(store.consume('203.0.113.10')).toEqual({ allowed: true });
    expect(store.consume('203.0.113.10')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    now += 60_000;

    expect(store.consume('203.0.113.10')).toEqual({ allowed: true });
  });

  it('fails closed at capacity without evicting active rate-limit buckets', () => {
    const store = new AuthRateLimitStore({
      maxRequests: 1,
      maxKeys: 2,
      sweepIntervalMs: 1_000,
      windowMs: 60_000,
      now: () => now,
    });

    expect(store.consume('203.0.113.1')).toEqual({ allowed: true });
    expect(store.consume('203.0.113.1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(store.consume('203.0.113.2')).toEqual({ allowed: true });

    expect(store.consume('203.0.113.3')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });

    expect(store.size).toBe(2);
    expect(store.consume('203.0.113.1')).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it('removes expired entries during automatic sweeps', () => {
    const store = new AuthRateLimitStore({
      maxRequests: 2,
      maxKeys: 2,
      sweepIntervalMs: 1_000,
      windowMs: 2_000,
      now: () => now,
    });

    store.consume('203.0.113.1');
    store.consume('203.0.113.2');

    now += 2_000;
    store.consume('203.0.113.4');

    expect(store.size).toBe(1);
  });
});

describe('createAuthRateLimitMiddleware', () => {
  it('keeps Railway clients isolated and ignores spoofed client headers across the complete proxy chain', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(
      '/api/auth',
      createAuthRateLimitMiddleware({
        maxRequests: 2,
        maxKeys: 100,
        sweepIntervalMs: 1_000,
        windowMs: 60_000,
      }),
    );
    app.post('/api/auth/sign-in/email', (_request, response) => {
      response.sendStatus(204);
    });

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));

    try {
      const { port } = server.address() as AddressInfo;
      // Supported chain:
      // 1. A client may send arbitrary X-Real-IP/X-Forwarded-For values.
      // 2. Railway overwrites X-Real-IP with the connection's real client IP.
      // 3. nginx, running in Railway mode, replaces X-Forwarded-For with that
      //    trusted X-Real-IP instead of appending attacker-controlled values.
      // 4. The private API trusts exactly its one nginx hop.
      const throughRailwayAndNginx = (
        actualClientIp: string,
        attackerSuppliedIp: string,
      ): Promise<{ status: number; retryAfter?: string }> => {
        const headersAfterRailway = {
          // Railway overwrites this value from the connection identity.
          xRealIp: actualClientIp,
          // Other forwarding input remains attacker-controlled and must not
          // be used by nginx as the API's client identity.
          xForwardedFor: attackerSuppliedIp,
        };
        const forwardedForAfterNginx = headersAfterRailway.xRealIp;

        return new Promise((resolve, reject) => {
          const request = httpRequest(
            {
              agent: false,
              headers: { 'X-Forwarded-For': forwardedForAfterNginx },
              host: '127.0.0.1',
              method: 'POST',
              path: '/api/auth/sign-in/email',
              port,
            },
            (response) => {
              response.resume();
              response.once('end', () => {
                const retryAfter = response.headers['retry-after'];
                resolve({
                  status: response.statusCode ?? 0,
                  ...(typeof retryAfter === 'string' ? { retryAfter } : {}),
                });
              });
            },
          );
          request.once('error', reject);
          request.end();
        });
      };

      expect(
        (await throughRailwayAndNginx('203.0.113.10', '198.51.100.1')).status,
      ).toBe(204);
      expect(
        (await throughRailwayAndNginx('203.0.113.10', '198.51.100.2')).status,
      ).toBe(204);

      const blocked = await throughRailwayAndNginx(
        '203.0.113.10',
        '198.51.100.3',
      );

      expect(blocked.status).toBe(429);
      expect(blocked.retryAfter).toBe('60');

      // A second real client must not share the Railway edge's bucket.
      expect(
        (await throughRailwayAndNginx('203.0.113.11', '203.0.113.10')).status,
      ).toBe(204);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
