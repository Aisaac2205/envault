import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// Better Auth reads the database schema when auth.config.ts is first
// evaluated and caches a mismatch for the life of the process. Migrations must
// therefore have run BEFORE that module is imported, which means main.ts may
// not reach it through any static import.

const srcRoot = __dirname;
const mainPath = resolve(srcRoot, 'main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

// Specifiers of `import ... from 'x'`, `import 'x'` and `export ... from 'x'`.
// `import type` is erased by the compiler, so it never loads the module.
const staticSpecifiers = (source: string): string[] => {
  const pattern =
    /^[ \t]*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+|(?=['"]))['"]([^'"]+)['"]/gm;
  return [...source.matchAll(pattern)]
    .filter((match) => !(match[1] === 'import' && match[2]))
    .map((match) => match[3]);
};

const resolveRelative = (fromFile: string, specifier: string): string | null => {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

// Every source file main.ts loads at startup through relative static imports.
const reachableFromMain = (): Map<string, string[]> => {
  const reached = new Map<string, string[]>();
  const pending = [mainPath];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (reached.has(file)) continue;
    const specifiers = staticSpecifiers(readFileSync(file, 'utf8'));
    reached.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const target = resolveRelative(file, specifier);
      if (target) pending.push(target);
    }
  }
  return reached;
};

describe('API boot order', () => {
  it('has no static import of the app module or of anything under ./auth', () => {
    const offending = staticSpecifiers(mainSource).filter((specifier) =>
      /^\.\/(app\.module|auth)(\/|$)/.test(specifier),
    );

    expect(offending).toEqual([]);
  });

  it('never reaches Better Auth or the auth module through main.ts static imports', () => {
    const reached = reachableFromMain();
    const authDirectory = resolve(srcRoot, 'auth') + sep;
    const reachedRelative = [...reached.keys()].map((file) =>
      relative(srcRoot, file).split(sep).join('/'),
    );

    expect(reachedRelative).toContain('main.ts');
    expect(reachedRelative).not.toContain('app.module.ts');
    expect([...reached.keys()].filter((file) => file.startsWith(authDirectory))).toEqual([]);

    const betterAuthImporters = [...reached.entries()]
      .filter(([, specifiers]) =>
        specifiers.some((specifier) => specifier.startsWith('better-auth')),
      )
      .map(([file]) => relative(srcRoot, file).split(sep).join('/'));
    expect(betterAuthImporters).toEqual([]);
  });

  it('keeps dotenv as the first import so DATABASE_URL is loaded before the migration runner reads it', () => {
    expect(staticSpecifiers(mainSource)[0]).toBe('dotenv/config');
  });

  it('awaits runPendingMigrations() before dynamically importing the app module and creating the app', () => {
    const migrations = mainSource.indexOf('await runPendingMigrations()');
    const appModule = mainSource.indexOf("await import('./app.module')");
    const factory = mainSource.indexOf('NestFactory.create');

    expect(migrations).toBeGreaterThan(-1);
    expect(appModule).toBeGreaterThan(-1);
    expect(factory).toBeGreaterThan(-1);
    expect(migrations).toBeLessThan(appModule);
    expect(appModule).toBeLessThan(factory);
  });
});
