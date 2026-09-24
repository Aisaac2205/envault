import type { CodeLanguage } from '../lib/highlight';

export type SnippetId = 'docker' | 'railway';

export const SNIPPET_LANGUAGES: Record<SnippetId, CodeLanguage> = {
  docker: 'yaml',
  railway: 'shell',
};

export const SNIPPETS: Record<SnippetId, string> = {
  docker: `# docker-compose.yml (repo root)
services:
  api:
    image: jefedesarrollocoide/vaultly-api:0.1.1
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: production
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  web:
    image: jefedesarrollocoide/vaultly-web:0.1.1
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: production
    environment:
      API_UPSTREAM: api:\${PORT:-3000}
    ports:
      - "5173:80"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: \${DB_NAME:?required}
      POSTGRES_USER: \${DB_USER:?required}
      POSTGRES_PASSWORD: \${DB_PASSWORD:?required}
    volumes:
      - db_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  db_data:`,

  railway: `# Railway: vaultly-api + vaultly-web + Postgres
# Reference variables auto-fill these at deploy

# vaultly-api
DB_HOST=\${{Postgres.PGHOST}}
DB_PORT=\${{Postgres.PGPORT}}
DB_NAME=\${{Postgres.PGDATABASE}}
DB_USER=\${{Postgres.PGUSER}}
DB_PASSWORD=\${{Postgres.PGPASSWORD}}
BETTER_AUTH_SECRET=<64-char-hex-string>
BETTER_AUTH_URL=https://<web-public-domain>
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=vaultly-dumps

# vaultly-web
VITE_APP_BASE_URL=https://<public-domain>
API_UPSTREAM=<api-private-domain>:3000`,
};
