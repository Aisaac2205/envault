import type { LogLevel } from '@nestjs/common';

/**
 * Levels the Nest logger prints for a given `NODE_ENV`.
 *
 * Production prints `log`, `warn` and `error` (Nest turns `fatal` on together
 * with `error`) and leaves out `debug` and `verbose`: the R2 upload and download
 * lines, for one, are debug output that belongs in development. Every other
 * value keeps all levels, which is also what Nest does when it is given no
 * levels. That covers `development` and `test`, an unset variable (the
 * environment schema defaults it to `development`) and a misspelled one, which
 * the schema refuses to boot with anyway.
 *
 * It takes the raw value because the logger has to be set before Nest builds
 * the application, so `ConfigService` does not exist yet.
 */
export function resolveLogLevels(nodeEnv: string | undefined): LogLevel[] {
  if (nodeEnv === 'production') {
    return ['error', 'warn', 'log'];
  }
  return ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
}
