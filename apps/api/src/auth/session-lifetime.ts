export const SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60;
export const SESSION_REFRESH_INTERVAL_SECONDS = 5 * 60;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export function isPastAbsoluteTimeout(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() >= SESSION_ABSOLUTE_TIMEOUT_MS;
}
