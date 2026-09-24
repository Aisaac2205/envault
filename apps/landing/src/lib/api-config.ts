export function getApiBaseUrl(): string {
  const raw =
    (typeof import.meta !== 'undefined' ? import.meta.env?.PUBLIC_API_URL : undefined) ??
    (typeof process !== 'undefined' ? process.env?.PUBLIC_API_URL : undefined);

  if (!raw) {
    return 'http://localhost:3000';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.origin !== 'null') {
      return parsed.origin;
    }
  } catch {
    // Fallback
  }

  return 'http://localhost:3000';
}
