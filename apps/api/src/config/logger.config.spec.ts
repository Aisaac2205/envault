/// <reference types="jest" />
import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { resolveLogLevels } from './logger.config';

const ALL_LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

// What the Nest logger really prints for a list of levels (levels cascade, so
// listing `error` also turns `fatal` on).
const enabledLevels = (levels: LogLevel[]): LogLevel[] => {
  const logger = new ConsoleLogger('LoggerConfigSpec', { logLevels: levels });
  return ALL_LEVELS.filter((level) => logger.isLevelEnabled(level));
};

describe('resolveLogLevels', () => {
  describe('production', () => {
    it('keeps error, warn and log', () => {
      expect(resolveLogLevels('production')).toEqual(
        expect.arrayContaining(['error', 'warn', 'log']),
      );
    });

    it('drops debug and verbose', () => {
      const levels = resolveLogLevels('production');

      expect(levels).not.toContain('debug');
      expect(levels).not.toContain('verbose');
    });

    it('makes the Nest logger print everything down to log, fatal included, and nothing finer', () => {
      expect(enabledLevels(resolveLogLevels('production'))).toEqual([
        'fatal',
        'error',
        'warn',
        'log',
      ]);
    });
  });

  describe.each(['development', 'test'])('%s', (nodeEnv) => {
    it('keeps every level, debug and verbose included', () => {
      expect(enabledLevels(resolveLogLevels(nodeEnv))).toEqual(ALL_LEVELS);
    });
  });

  describe('when NODE_ENV is not one of the three the environment schema accepts', () => {
    it('undefined keeps every level, like the schema default of development', () => {
      expect(enabledLevels(resolveLogLevels(undefined))).toEqual(ALL_LEVELS);
    });

    it.each(['', 'staging', 'Production', 'prod'])(
      '"%s" keeps every level: only the exact value production quiets the logger (the schema refuses to boot with the others)',
      (nodeEnv) => {
        expect(enabledLevels(resolveLogLevels(nodeEnv))).toEqual(ALL_LEVELS);
      },
    );
  });

  it('hands out a fresh list each time, so a caller cannot change the next result', () => {
    const first = resolveLogLevels('production');
    first.push('debug');

    expect(resolveLogLevels('production')).not.toContain('debug');
  });
});
