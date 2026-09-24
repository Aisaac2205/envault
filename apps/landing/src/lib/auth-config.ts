/**
 * Dynamic URL configuration for EnVault Management Web App (apps/web)
 * Local development: http://localhost:5173 (or configured via PUBLIC_WEB_URL)
 * Production: configured via PUBLIC_WEB_URL or PUBLIC_APP_URL.
 */

export function getWebBaseUrl(): string {
  const raw =
    (typeof import.meta !== 'undefined' ? import.meta.env?.PUBLIC_WEB_URL : undefined) ??
    (typeof process !== 'undefined' ? process.env?.PUBLIC_WEB_URL : undefined);

  if (!raw) {
    return 'http://localhost:5173';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.origin !== 'null') {
      return parsed.origin;
    }
  } catch {
    // Fallback
  }

  return 'http://localhost:5173';
}

export function getAuthUrl(nextPath = '/'): string {
  const baseUrl = getWebBaseUrl().replace(/\/$/, '');
  const encodedNext = encodeURIComponent(nextPath);
  return `${baseUrl}/login?next=${encodedNext}`;
}
