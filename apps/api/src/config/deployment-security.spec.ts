import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../..');
const readRepositoryFile = (path: string): string =>
  readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('production deployment security contract', () => {
  const compose = readRepositoryFile('docker-compose.yml');
  const apiService =
    compose.match(/\n\s{2}api:\n([\s\S]*?)\n\s{2}web:\n/)?.[1] ?? '';
  const webService =
    compose.match(/\n\s{2}web:\n([\s\S]*?)\n\s{2}db:\n/)?.[1] ?? '';

  it('keeps the API private and does not inject the root env file into nginx', () => {
    expect(apiService).not.toMatch(/^\s{4}ports:/m);
    expect(webService).not.toContain('env_file:');
    const webEnvironment =
      webService.match(/\s{4}environment:\n([\s\S]*?)(?=\n\s{4}\S)/)?.[1] ?? '';
    expect(webEnvironment).toContain('API_UPSTREAM: api:${PORT:-3000}');
    expect(
      webEnvironment
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')),
    ).toEqual([
      'API_UPSTREAM: api:${PORT:-3000}',
      'CSP_HEADER_NAME: ${CSP_HEADER_NAME:-Content-Security-Policy-Report-Only}',
    ]);
  });

  it('documents the 32-byte encryption key accurately', () => {
    const example = readRepositoryFile('.env.example');
    // Asserts the guarantee, not one phrasing of it: wherever the wording
    // lives, the example must still tell the reader how to produce a valid
    // key and how long it has to be. A short or guessable ENCRYPTION_KEY
    // weakens every connection password stored at rest, and env.validation
    // only rejects the wrong length — never a weak value of the right one.
    expect(example).toContain('ENCRYPTION_KEY=');
    expect(example).toMatch(/openssl rand -hex 32/);
    expect(example).toMatch(/64 hex/i);
    expect(example).toContain(
      'CSP_HEADER_NAME=Content-Security-Policy-Report-Only',
    );
  });

  it('sources the client IP selector before nginx expands its templates', () => {
    const dockerfile = readRepositoryFile('apps/web/Dockerfile');
    const entrypoint = readRepositoryFile(
      'apps/web/docker-entrypoint.d/10-security-config.envsh',
    );

    expect(dockerfile).toContain(
      'COPY apps/web/docker-entrypoint.d/10-security-config.envsh /docker-entrypoint.d/10-security-config.envsh',
    );
    expect(dockerfile).toContain(
      'RUN chmod +x /docker-entrypoint.d/10-security-config.envsh',
    );
    expect(dockerfile).not.toContain('10-security-config.sh');
    expect(entrypoint).toContain('export CLIENT_IP_SOURCE');
  });

  it('applies inherited security headers to static, API, and SSE responses', () => {
    const nginx = readRepositoryFile(
      'apps/web/templates/default.conf.template',
    );
    const headers = readRepositoryFile('apps/web/nginx/security-headers.conf');
    const dockerfile = readRepositoryFile('apps/web/Dockerfile');
    const entrypoint = readRepositoryFile(
      'apps/web/docker-entrypoint.d/10-security-config.envsh',
    );

    expect(headers).toContain('X-Content-Type-Options "nosniff" always');
    expect(headers).toContain('add_header ${CSP_HEADER_NAME}');
    expect(headers).toContain("connect-src 'self'");
    expect(dockerfile).toContain(
      'ENV CSP_HEADER_NAME=Content-Security-Policy-Report-Only',
    );
    expect(dockerfile).toContain(
      'NGINX_LOCAL_RESOLVERS|API_UPSTREAM|CSP_HEADER_NAME',
    );
    expect(nginx).toContain('include /etc/nginx/conf.d/security-headers.inc;');
    expect(nginx).toContain('proxy_buffering off;');
    expect(nginx).toContain('proxy_read_timeout 3600s;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-For ${CLIENT_IP_SOURCE};');
    expect(entrypoint).toContain('RAILWAY_ENVIRONMENT_ID');
    expect(entrypoint).toContain('CLIENT_IP_SOURCE="\\$http_x_real_ip"');
    expect(entrypoint).toContain('CLIENT_IP_SOURCE="\\$remote_addr"');
    expect(entrypoint).toContain('Content-Security-Policy-Report-Only');
    expect(entrypoint).toContain(
      'Content-Security-Policy|Content-Security-Policy-Report-Only)',
    );
    expect(entrypoint).toContain('exit 1');

    const cacheLocations = nginx.match(
      /location (?:=|~\*)[^{]+\{[\s\S]*?\n\s{4}\}/g,
    );
    expect(cacheLocations).not.toBeNull();
    for (const location of cacheLocations ?? []) {
      expect(location).toContain(
        'include /etc/nginx/conf.d/security-headers.inc;',
      );
    }
  });

  it('pins one patched Node.js release across .nvmrc files and Docker images', () => {
    const nodeVersion = readRepositoryFile('.nvmrc').trim();
    expect(nodeVersion).toMatch(/^22\.\d+\.\d+$/);
    // Cloudflare Pages builds the landing from apps/landing and only reads
    // the .nvmrc in that directory.
    expect(readRepositoryFile('apps/landing/.nvmrc').trim()).toBe(nodeVersion);
    for (const dockerfile of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
      expect(readRepositoryFile(dockerfile)).toMatch(
        new RegExp(
          `^FROM node:${nodeVersion.replace(/\./g, '\\.')}-[a-z-]+@sha256:[0-9a-f]{64} AS base`,
          'm',
        ),
      );
    }
  });
});
