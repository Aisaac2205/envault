import type { Locale } from '../i18n/types';

export const REPOSITORY_URL = 'https://github.com/Aisaac2205/envault';
export const REPOSITORY_API_URL = 'https://api.github.com/repos/Aisaac2205/envault';

/** Below this, a visible count reads as negative social proof, so the star button shows no number. */
export const MIN_VISIBLE_STARS = 100;

const STAR_COUNT_TIMEOUT_MS = 3000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface FetchStarCountOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Reads the repository star count at build time. Resolves to `null` on any failure (non-200,
 * network error, timeout, unexpected body) so a build without network still succeeds.
 */
export async function fetchStarCount({
  fetchImpl = fetch,
  timeoutMs = STAR_COUNT_TIMEOUT_MS,
}: FetchStarCountOptions = {}): Promise<number | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Racing the timer, not only aborting, keeps the deadline even if a fetch ignores the signal.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  const request = async (): Promise<number | null> => {
    try {
      const response = await fetchImpl(REPOSITORY_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'envault-landing' },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return parseStarCount(await response.json());
    } catch {
      return null;
    }
  };

  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function parseStarCount(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('stargazers_count' in body)) return null;
  const count = body.stargazers_count;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}

let starCountRequest: Promise<number | null> | undefined;

/** One request per build: every page that renders the star button shares the same answer. */
export function getStarCount(): Promise<number | null> {
  starCountRequest ??= fetchStarCount();
  return starCountRequest;
}

export function visibleStarCount(count: number | null): number | null {
  return count !== null && count >= MIN_VISIBLE_STARS ? count : null;
}

export function formatStarCount(count: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-ES', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(count);
}
