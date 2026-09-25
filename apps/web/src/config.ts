export interface AppConfig {
  apiUrl: string;
  apiBaseUrl: string;
}

export function createAppConfig(rawApiUrl?: string): AppConfig {
  const apiUrl = (rawApiUrl ?? "").replace(/\/+$/, "");

  if (apiUrl) {
    let pathname: string;
    try {
      pathname = new URL(apiUrl).pathname;
    } catch {
      throw new Error(
        `VITE_API_URL is not a valid absolute URL: "${apiUrl}". It must be a bare origin, e.g. "https://api.example.com" — or empty for a same-origin deployment.`,
      );
    }
    if (pathname !== "" && pathname !== "/") {
      throw new Error(
        `VITE_API_URL must be a bare origin with no path, got "${apiUrl}". ` +
          `Better Auth appends its own /api/auth to this value — a path here (like "/api") ` +
          `makes it skip that and silently breaks every auth request.`,
      );
    }
  }

  return {
    apiUrl,
    apiBaseUrl: `${apiUrl}/api`,
  };
}

export const APP_CONFIG: AppConfig = createAppConfig(
  import.meta.env.VITE_API_URL,
);

