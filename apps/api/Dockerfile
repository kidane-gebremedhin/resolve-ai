# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @csb/api build
RUN pnpm --filter @csb/api deploy --prod /out

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && apk add --no-cache wget
COPY --from=build --chown=app:app /out ./
# The local-disk storage adapter writes attachments to <cwd>/uploads (= /app/uploads).
# /app is root-owned, so the non-root `app` user can't create it at runtime
# (EACCES on mkdir) — pre-create it and hand it to `app`. Mount a volume here in
# production for persistence (attachments are otherwise lost on redeploy).
RUN mkdir -p /app/uploads && chown -R app:app /app/uploads
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/index.js"]
