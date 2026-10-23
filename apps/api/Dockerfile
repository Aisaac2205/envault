# ── Stage 1: Base ──────────────────────────────────────────────
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
RUN corepack enable
# Majors of the PostgreSQL client (pg_dump / pg_restore) installed side by side
# under /usr/lib/postgresql/<major>/bin. The API dumps with the client of the
# source server major and restores with the one of the target major, so this list
# must cover every server major the connections use. Space separated.
ARG POSTGRES_CLIENT_VERSIONS="14 15 16 17 18"
# Fail fast and clearly on an empty or malformed list, before any apt work.
RUN set -- ${POSTGRES_CLIENT_VERSIONS} \
     && if [ "$#" -eq 0 ]; then \
          echo "POSTGRES_CLIENT_VERSIONS is empty: list at least one PostgreSQL major, for example \"14 15 16 17 18\"" >&2; \
          exit 1; \
        fi \
     && for v in "$@"; do \
          case "$v" in ''|*[!0-9]*) \
            echo "POSTGRES_CLIENT_VERSIONS must be a space-separated list of PostgreSQL majors (got \"$v\")" >&2; \
            exit 1;; \
          esac; \
        done
RUN apt-get update \
     && apt-get install -y --no-install-recommends \
     ca-certificates \
     curl \
     gnupg \
     postgresql-common \
     tini \
     && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
     && apt-get install -y --no-install-recommends $(printf 'postgresql-client-%s ' ${POSTGRES_CLIENT_VERSIONS}) \
     && curl -fsSL https://repo.percona.com/apt/percona-release_latest.generic_all.deb \
     -o /tmp/percona-release.deb \
     && apt-get install -y /tmp/percona-release.deb \
     && rm /tmp/percona-release.deb \
     && percona-release setup ps80 \
     && apt-get install -y --no-install-recommends percona-server-client \
     && apt-get purge -y --auto-remove curl gnupg \
     && for v in ${POSTGRES_CLIENT_VERSIONS}; do \
          for tool in pg_dump pg_restore; do \
            test -x "/usr/lib/postgresql/${v}/bin/${tool}" \
              || { echo "Build check failed: /usr/lib/postgresql/${v}/bin/${tool} is missing" >&2; exit 1; }; \
          done; \
        done \
     && rm -rf /var/lib/apt/lists/*

# ── Stage 2: Dev ───────────────────────────────────────────────
FROM base AS dev
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# ── Stage 3: Build ─────────────────────────────────────────────
FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

RUN pnpm --filter @vaultly-control/api build

RUN pnpm --filter @vaultly-control/api --prod deploy /prod/api

# ── Stage 4: Production ────────────────────────────────────────
FROM base AS production
WORKDIR /app

COPY --from=build --chown=node:node /prod/api ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
