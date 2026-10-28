/**
 * The first line of an error that has words on it, trimmed: a dump tool writes
 * the cause first and the details (`DETAIL:`, `HINT:`) below it. `null` for an
 * error that is missing or blank.
 */
export function firstErrorLine(message: string | null): string | null {
  if (!message) return null;
  for (const line of message.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
