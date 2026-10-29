import { describe, expect, it, vi } from 'vitest';
import {
  MIN_VISIBLE_STARS,
  REPOSITORY_API_URL,
  fetchStarCount,
  formatStarCount,
  visibleStarCount,
} from './stars';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchStarCount', () => {
  it('returns the stargazers count from a successful response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ stargazers_count: 321 }));

    await expect(fetchStarCount({ fetchImpl })).resolves.toBe(321);
    expect(fetchImpl).toHaveBeenCalledWith(REPOSITORY_API_URL, expect.any(Object));
  });

  it('returns null when GitHub answers with a non-200 status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'API rate limit exceeded' }, 403));

    await expect(fetchStarCount({ fetchImpl })).resolves.toBeNull();
  });

  it('returns null when the network request fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchStarCount({ fetchImpl })).resolves.toBeNull();
  });

  it('returns null and aborts the request when GitHub does not answer in time', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });

    await expect(fetchStarCount({ fetchImpl, timeoutMs: 10 })).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('returns null when the body is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Unicorn</html>', { status: 200 }));

    await expect(fetchStarCount({ fetchImpl })).resolves.toBeNull();
  });

  it.each([
    ['a body without the field', { message: 'Not Found' }],
    ['a non-numeric count', { stargazers_count: '321' }],
    ['a negative count', { stargazers_count: -1 }],
    ['a null body', null],
  ])('returns null for %s', async (_case, body) => {
    const fetchImpl = vi.fn(async () => jsonResponse(body));

    await expect(fetchStarCount({ fetchImpl })).resolves.toBeNull();
  });
});

describe('visibleStarCount', () => {
  it('hides counts below the visibility threshold', () => {
    expect(visibleStarCount(MIN_VISIBLE_STARS - 1)).toBeNull();
    expect(visibleStarCount(0)).toBeNull();
  });

  it('shows counts at or above the visibility threshold', () => {
    expect(visibleStarCount(MIN_VISIBLE_STARS)).toBe(MIN_VISIBLE_STARS);
    expect(visibleStarCount(4200)).toBe(4200);
  });

  it('keeps a missing count missing', () => {
    expect(visibleStarCount(null)).toBeNull();
  });
});

describe('formatStarCount', () => {
  it('shortens large counts in the reader’s language', () => {
    expect(formatStarCount(1234, 'en')).toBe('1.2K');
    expect(formatStarCount(1234, 'es')).toBe('1,2 mil');
  });

  it('keeps small counts whole', () => {
    expect(formatStarCount(150, 'en')).toBe('150');
    expect(formatStarCount(150, 'es')).toBe('150');
  });
});
