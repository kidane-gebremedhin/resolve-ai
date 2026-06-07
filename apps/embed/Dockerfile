FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/embed/package.json apps/embed/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @csb/embed
COPY apps/embed apps/embed
# VITE_* are inlined into widget.js at build time as fallbacks for the loader
# (the host page's data-widget-url/data-api-url still override per install).
ARG VITE_WIDGET_URL=http://localhost:3001
ARG VITE_API_URL=http://localhost:4000
ENV VITE_WIDGET_URL=$VITE_WIDGET_URL VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @csb/embed build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache wget
COPY apps/embed/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/embed/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/widget.js > /dev/null || exit 1
