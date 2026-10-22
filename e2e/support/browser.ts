import type { BrowserContext } from '@playwright/test';
import { BASE_URL, DIRECT_API_URL } from './env';
import { uniqueClientIp } from './unique';

const AUTH_PREFIX = '/api/auth/';

/**
 * Gives a browser context an allowance of its own at Better Auth's rate limiter.
 *
 * Better Auth counts requests per client IP and the limits cannot be changed:
 * 3 sign-ins per 10 s (D3) and, for every other `/api/auth/*` request, 100 per
 * 10 s. The browser reaches the API through the web proxy, which overwrites
 * `X-Forwarded-For`, so all contexts, workers and projects would share one
 * bucket together with `setup`. The app asks `get-session` on every page it
 * opens, so a parallel UI run exhausts the 100 within seconds and the app
 * reads the 429 as "signed out" and redirects to the login page.
 *
 * Each `/api/auth/*` request the page makes is therefore repeated against the
 * API's own port, which trusts `X-Forwarded-For`, with an address that belongs
 * to this context alone, and the answer is handed back to the page as if the
 * proxy had sent it. The status, the body and `Set-Cookie` pass through, so the
 * page runs the real forms against the real API and ends up with the real
 * session cookies (they are tied to the host name, not the port). Only the hop
 * through nginx is skipped for these calls; every other request, `/api/*` data
 * and the app itself included, still goes through it, and `setup` and the API
 * project exercise the proxied auth routes.
 *
 * A route a test adds to its page takes precedence over this one, so a test
 * can still answer a sign-in with a canned response.
 */
export async function routeAuthToOwnRateLimitBucket(context: BrowserContext): Promise<void> {
  const clientIp = uniqueClientIp();

  await context.route(
    (url) => url.pathname.startsWith(AUTH_PREFIX),
    async (route) => {
      const request = route.request();
      const { pathname, search } = new URL(request.url());
      const contentType = request.headers()['content-type'];

      // Cookies are not copied: the fetch sends the context's own, which are
      // valid for the direct port because cookies do not isolate by port.
      const response = await route.fetch({
        url: `${DIRECT_API_URL}${pathname}${search}`,
        headers: {
          ...(contentType && { 'Content-Type': contentType }),
          // Better Auth refuses requests without an Origin it trusts.
          Origin: BASE_URL,
          'X-Forwarded-For': clientIp,
        },
      });
      await route.fulfill({ response });
    },
  );
}
