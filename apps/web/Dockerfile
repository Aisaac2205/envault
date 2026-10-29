# ── Stage 1: Base ──────────────────────────────────────────────
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
RUN corepack enable

# ── Stage 2: Dev ───────────────────────────────────────────────
FROM base AS dev
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# ── Stage 3: Build ─────────────────────────────────────────────
FROM base AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/components.json ./apps/web/
COPY apps/web/index.html ./apps/web/
COPY apps/web/public ./apps/web/public
COPY apps/web/src ./apps/web/src

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @vaultly-control/web build

# ── Stage 4: Production (nginx) ────────────────────────────────
# Mainline nginx on Alpine (the image `nginx:alpine` pointed to), pinned by tag
# and digest so a rebuild of the same commit gets the same base. Dependabot
# bumps both together.
FROM nginx:1.31.8-alpine@sha256:785835ea65db4bba6f021acc0f3be91b0fef76a53fe41f8588c6698d2aed0606 AS production

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

COPY apps/web/templates/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/nginx/security-headers.conf /etc/nginx/templates/security-headers.inc.template
COPY apps/web/docker-entrypoint.d/10-security-config.envsh /docker-entrypoint.d/10-security-config.envsh
RUN chmod +x /docker-entrypoint.d/10-security-config.envsh

# Activates the official image's own /docker-entrypoint.d/15-local-resolvers.envsh,
# which exports NGINX_LOCAL_RESOLVERS from /etc/resolv.conf (off by default).
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
ENV NGINX_ENVSUBST_FILTER=^(NGINX_LOCAL_RESOLVERS|API_UPSTREAM|CSP_HEADER_NAME|CLIENT_IP_SOURCE)$
ENV API_UPSTREAM=api:3000
# Enforced by default. script-src allows the inline theme script in index.html
# by its sha256 hash (deployment-security.spec.ts keeps the two in sync). Set
# Content-Security-Policy-Report-Only only to debug a violation.
ENV CSP_HEADER_NAME=Content-Security-Policy
ENV CLIENT_IP_MODE=auto

EXPOSE 80

# Probe the IPv4 loopback: inside the container `localhost` resolves to ::1
# first and nginx only listens on 0.0.0.0:80, so a probe to `localhost` is
# refused and the container is reported unhealthy while the site answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
