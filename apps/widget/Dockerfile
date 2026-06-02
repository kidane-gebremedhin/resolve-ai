# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/widget/package.json apps/widget/
COPY packages/ui/package.json packages/ui/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @csb/widget build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && apk add --no-cache wget
COPY --from=build --chown=app:app /repo/apps/widget/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/widget/.next/static ./apps/widget/.next/static
COPY --from=build --chown=app:app /repo/apps/widget/public ./apps/widget/public
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["node", "apps/widget/server.js"]
