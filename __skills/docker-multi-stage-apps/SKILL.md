---
name: docker-multi-stage-apps
description: Author per-app multi-stage Dockerfiles (web, widget, embed, api) for the pnpm + Turborepo monorepo. Targets Node 20 alpine runtime, Next.js standalone output, and nginx for the embed loader. Use during Phase 0 once the workspace is bootstrapped so CI can smoke-build images. Implements __specs/18-cicd-pipeline.md §3.
---

# Multi-Stage Dockerfiles (per app)

## When to use

Phase 0, after [`pnpm-turbo-monorepo`](../pnpm-turbo-monorepo/) and before [`github-actions-monorepo`](../github-actions-monorepo/) — CI's `docker-build` smoke job needs working Dockerfiles.

## Prerequisites

- `apps/{web,widget,embed,api}` have `package.json` files declaring their build/start scripts
- `next.config.ts` in `apps/web` and `apps/widget` set `output: 'standalone'`
- `apps/embed/nginx.conf` written (see step 4 below)

## Procedure

The full Dockerfile bodies live in [`__specs/18-cicd-pipeline.md`](../../__specs/18-cicd-pipeline.md) §3 — copy verbatim. Do not invent variants. Summary:

1. **`apps/web/Dockerfile`** (spec §3.1) — 4-stage: `base` → `deps` (pnpm install with cache mount) → `build` (`pnpm --filter @csb/web build` + `pnpm deploy --prod /out`) → `runtime` (`node:20-alpine`, non-root user, copies `.next/standalone` + `.next/static` + `public`, exposes 3000, healthcheck on `/api/health`).

2. **`apps/widget/Dockerfile`** — identical to web but `--filter @csb/widget` and `EXPOSE 3001`.

3. **`apps/api/Dockerfile`** (spec §3.3) — 4-stage: `base` → `deps` → `build` (`tsc` → `dist/`) → `runtime` (copies `/out`, `EXPOSE 4000`, healthcheck `/health`).

4. **`apps/embed/Dockerfile`** (spec §3.2) — 2-stage: `build` (Vite) → `nginx:1.27-alpine`. Requires `apps/embed/nginx.conf`:
   ```nginx
   server {
     listen 80 default_server;
     server_name _;
     root /usr/share/nginx/html;
     location = /widget.js {
       add_header Cache-Control "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400";
       add_header Access-Control-Allow-Origin "*";
       try_files $uri =404;
     }
     location / { try_files $uri $uri/ =404; }
   }
   ```

5. **Root `.dockerignore`** — must include `node_modules`, `.next/`, `dist/`, `.turbo/`, `coverage/`, `.git/`, `__specs/`, `__plans/`, `__skills/`, `.env*` (except `.env.example`), `*.log`, `Dockerfile*`, `docker-compose*.yml`, `coolify/`. Without this, the build context balloons past 100 MB and breaks BuildKit cache.

6. **Local smoke test**:
   ```bash
   docker build -f apps/web/Dockerfile -t csb-web:dev .
   docker build -f apps/widget/Dockerfile -t csb-widget:dev .
   docker build -f apps/embed/Dockerfile -t csb-embed:dev .
   docker build -f apps/api/Dockerfile -t csb-api:dev .
   docker run --rm -p 4000:4000 -e MONGODB_URI=... csb-api:dev
   curl http://localhost:4000/health
   ```

## Gotchas

- **`output: 'standalone'`** is required in `next.config.ts` — without it the runtime stage cannot find `server.js`. Confirm against `node_modules/next/dist/docs/` for Next 16 syntax (per project AGENTS.md).
- **`pnpm deploy --prod /out`** is a pnpm-specific command that flattens a workspace package + only its prod deps. If the version of pnpm changes, verify the command still exists.
- **Healthcheck endpoints**:
  - `apps/web` needs a `app/api/health/route.ts` returning 200 (App Router style)
  - `apps/api` exposes `/health` returning `{ ok, mongo: 'up'|'down', pinecone: 'up'|'down', uptime }` per spec §18 §3.3
- **Non-root user** in runtime stage (`USER app`) is required by the security spec — don't run as root.
- **Image size budget**: each runtime image must stay under 250 MB (spec §18 §9 acceptance). If web exceeds this, audit the standalone output for accidentally bundled dev deps.
- **Cache mounts** (`--mount=type=cache,target=/root/.local/share/pnpm/store`) need BuildKit; ensure `DOCKER_BUILDKIT=1` or `docker buildx`.
- **CORS on embed**: the `nginx.conf` *must* serve `widget.js` with `Access-Control-Allow-Origin: *` — the embed script is loaded cross-origin from arbitrary customer sites.

## Acceptance

- [ ] All 4 `docker build` commands succeed locally with no warnings
- [ ] Each runtime image is < 250 MB (`docker images csb-*`)
- [ ] `docker run csb-api:dev` exposes `/health` returning 200 within 30 s
- [ ] `docker run csb-embed:dev` serves `/widget.js` with the correct cache + CORS headers
- [ ] Images are reproducible (running the same build twice produces identical layer hashes)
- [ ] CI `docker-build` matrix job in [`github-actions-monorepo`](../github-actions-monorepo/) passes

## Specs referenced

- [`__specs/18-cicd-pipeline.md`](../../__specs/18-cicd-pipeline.md) §3 — full Dockerfile bodies
- [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) — port allocation
- [`__specs/12-security-compliance.md`](../../__specs/12-security-compliance.md) — non-root runtime requirement
