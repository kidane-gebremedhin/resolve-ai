# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/admin/package.json apps/admin/
COPY packages/ui/package.json packages/ui/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# NODE_ENV=production is required for `next build`: Coolify forwards the repo's
# .env NODE_ENV (development) as a build arg, which puts React in dev mode and
# crashes the /_global-error prerender. Pin it here so the build is always prod.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Inlined into the client bundle at build time (.env is .dockerignore'd). Default
# targets local docker-compose.full; override per deploy.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
# Brand name for the admin logo/header.
ARG NEXT_PUBLIC_APP_NAME=AddisAI
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
RUN pnpm --filter @csb/admin build

FROM node:20-alpine AS runtime
# HOSTNAME=0.0.0.0 so the standalone server binds all interfaces (Docker sets
# HOSTNAME to the container id otherwise, breaking the in-container healthcheck).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && apk add --no-cache wget
COPY --from=build --chown=app:app /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/admin/.next/static ./apps/admin/.next/static
USER app
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3003/login || exit 1
CMD ["node", "apps/admin/server.js"]
