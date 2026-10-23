/**
 * Errors that `BackupService.executeQueuedBackup` rejects with AFTER it has
 * already streamed the terminal `failed` event and closed the job's SSE
 * stream. BullMQ hands the same error object to the worker's `failed`
 * handler, which uses this to avoid closing the stream a second time while
 * still closing it for failures the service never saw (anything thrown
 * outside its try block).
 */
const closedStreamErrors = new WeakSet<object>();

export function markJobStreamClosed<E extends Error>(error: E): E {
  closedStreamErrors.add(error);
  return error;
}

export function isJobStreamClosed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && closedStreamErrors.has(error);
}
