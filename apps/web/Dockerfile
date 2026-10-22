# ── Stage 1: Base ──────────────────────────────────────────────
FROM node:22-alpine AS base
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
FROM nginx:alpine AS production

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
# Start in report-only mode. Set this to Content-Security-Policy after checking
# the browser console for violations in the deployed SPA.
ENV CSP_HEADER_NAME=Content-Security-Policy-Report-Only
ENV CLIENT_IP_MODE=auto

EXPOSE 80

# Probe the IPv4 loopback: inside the container `localhost` resolves to ::1
# first and nginx only listens on 0.0.0.0:80, so a probe to `localhost` is
# refused and the container is reported unhealthy while the site answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
