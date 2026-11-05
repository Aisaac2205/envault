import { authClient } from "./auth-client";
import { markSessionRejected } from "./session-rejected";

const LOGIN_PATH = "/login";

let pending: Promise<void> | null = null;

async function end(): Promise<void> {
  try {
    const result = await authClient.signOut();
    if (result?.error) markSessionRejected();
  } catch {
    markSessionRejected();
  }
  window.location.assign(LOGIN_PATH);
}

export function endExpiredSession(): Promise<void> {
  if (window.location.pathname === LOGIN_PATH) return Promise.resolve();
  pending ??= end().finally(() => {
    pending = null;
  });
  return pending;
}
