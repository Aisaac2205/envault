/**
 * A browser-side note that the session this browser still holds was rejected
 * by the API and could not be ended (the sign-out request itself failed, for
 * example with a 429). Without it the login screen would see the stale session,
 * send the visitor straight back to the app, the API would refuse it again,
 * and the two would bounce forever.
 *
 * It lives in `sessionStorage`, so it dies with the tab. Storage can be
 * blocked, in which case the note is simply not kept.
 */
const KEY = "envault:session-rejected";

export function markSessionRejected(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Blocked storage: nothing to remember it in.
  }
}

export function isSessionRejected(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearSessionRejected(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
}
