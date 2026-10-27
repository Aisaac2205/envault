import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../..');

const readBetterAuthVersion = (workspace: 'api' | 'web'): string | undefined => {
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'apps', workspace, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  return manifest.dependencies?.['better-auth'];
};

// A plain x.y.z with no range operator (^, ~, >=, *, x, tags, ...). A caret
// range once let a minor release tighten Better Auth's schema validation and
// break production login without any change in this repository.
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/;

describe('better-auth version pin', () => {
  const apiVersion = readBetterAuthVersion('api');
  const webVersion = readBetterAuthVersion('web');

  it('pins an exact version in the api workspace', () => {
    expect(apiVersion).toMatch(EXACT_SEMVER);
  });

  it('pins an exact version in the web workspace', () => {
    expect(webVersion).toMatch(EXACT_SEMVER);
  });

  it('uses the same version in api and web so server and client never drift', () => {
    expect(apiVersion).toBeDefined();
    expect(webVersion).toBe(apiVersion);
  });
});
