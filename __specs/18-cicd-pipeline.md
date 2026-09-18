# 18 — CI/CD Pipeline

## Overview

CI/CD is driven by **GitHub Actions** + **Turborepo remote cache** + **GitHub Container Registry (GHCR)** for image storage. Deployments are pulled by **Coolify** (see [20-coolify-deployment.md](./20-coolify-deployment.md)). Image tags are immutable and content-addressable; Coolify watches a webhook to trigger redeploys.

> **Principle**: CI must be deterministic. The same commit produces the same artifacts. No "latest" tags in production — always pin to git SHA.

---

## 1. Branching Model

| Branch | Purpose | Protected | Auto-deploy target |
|--------|---------|-----------|--------------------|
| `main` | Production-ready code | ✅ | Production (gated by manual approval) |
| `dev`, `staging` | Pre-prod integration | ✅ | Staging (automatic) |
| `feature/*`, `feat/*`, `fix/*` | Feature branches | — | Preview env (per-PR, optional) |
| `hotfix/*` | Emergency prod fixes | ✅ | Production (after manual approval) |

**Required checks on `dev`, `staging` and `main`** (GitHub branch protection):
- `ci / lint`
- `ci / type-check`
- `ci / test`
- `ci / build`
- `ci / docker-build` (smoke)
- At least one approving review
- Linear history (no merge commits — squash only)

---

## 2. Workflow Files

### 2.1 `.github/workflows/ci.yml` — runs on every PR + push

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main, staging, dev]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      changed: ${{ steps.filter.outputs.changes }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 2 }
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            web: ['apps/web/**', 'packages/ui/**', 'packages/shared-types/**']
            widget: ['apps/widget/**', 'packages/ui/**', 'packages/shared-types/**']
            embed: ['apps/embed/**']
            api: ['apps/api/**', 'packages/shared-types/**']
            root: ['package.json', 'pnpm-lock.yaml', 'turbo.json', '.github/**']

  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

  type-check:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run type-check
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

  test:
    needs: setup
    runs-on: ubuntu-latest
    services:
      mongo:
        image: mongo:7
        ports: ['27017:27017']
        options: >-
          --health-cmd "mongosh --eval 'db.runCommand({ ping: 1 })'"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run test
        env:
          MONGODB_URI: mongodb://localhost:27017/test
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: ci-test-secret-please-change-256-bit-xxxxxxxxxxxxxxxxxxxxxxxxxxx
          NODE_ENV: test
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

  build:
    needs: [lint, type-check]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run build
        env:
          TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
          TURBO_TEAM: ${{ vars.TURBO_TEAM }}

  docker-build:
    needs: build
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app: [web, widget, embed, api]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build (no push, smoke)
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          push: false
          tags: csb-${{ matrix.app }}:ci
          cache-from: type=gha,scope=${{ matrix.app }}
          cache-to: type=gha,mode=max,scope=${{ matrix.app }}

  security:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: '.nvmrc', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --prod --audit-level=high
        continue-on-error: false
      - uses: github/codeql-action/init@v3
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@v3
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 2.2 `.github/workflows/release-images.yml` — push to GHCR on main/staging/dev

```yaml
name: release-images
on:
  push:
    branches: [main, staging, dev]

permissions:
  contents: read
  packages: write
  id-token: write   # for cosign keyless

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app: [web, widget, embed, api]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/csb-${{ matrix.app }}
          tags: |
            type=ref,event=branch
            type=sha,format=long,prefix=
            type=raw,value=${{ github.ref_name }}-${{ github.run_number }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          # Sentry (spec 35). Only apps/web declares these ARGs; the other
          # Dockerfiles ignore them. Unset secrets resolve to empty strings, which
          # builds a bundle with reporting disabled rather than failing the job.
          # NEXT_PUBLIC_SENTRY_DSN must be a BUILD arg — it is inlined into the
          # client bundle. SENTRY_AUTH_TOKEN is used only to upload source maps in
          # the build stage and never reaches the runtime image.
          build-args: |
            NEXT_PUBLIC_SENTRY_DSN=${{ secrets.NEXT_PUBLIC_SENTRY_DSN }}
            NEXT_PUBLIC_SENTRY_ENVIRONMENT=${{ github.ref_name }}
            SENTRY_ORG=${{ secrets.SENTRY_ORG }}
            SENTRY_PROJECT=${{ secrets.SENTRY_PROJECT }}
            SENTRY_AUTH_TOKEN=${{ secrets.SENTRY_AUTH_TOKEN }}
            SENTRY_RELEASE=${{ github.sha }}
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: mode=max
          sbom: true
          cache-from: type=gha,scope=${{ matrix.app }}
          cache-to: type=gha,mode=max,scope=${{ matrix.app }}

      - uses: sigstore/cosign-installer@v3
      - run: |
          cosign sign --yes ghcr.io/${{ github.repository_owner }}/csb-${{ matrix.app }}@${{ steps.meta.outputs.digest }}

      - name: Notify Coolify
        env:
          COOLIFY_URL: ${{ secrets.COOLIFY_WEBHOOK_URL }}
          COOLIFY_TOKEN: ${{ secrets.COOLIFY_API_TOKEN }}
        run: |
          curl -fsSL -X POST "$COOLIFY_URL" \
            -H "Authorization: Bearer $COOLIFY_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"app\":\"${{ matrix.app }}\",\"branch\":\"${{ github.ref_name }}\",\"sha\":\"${{ github.sha }}\"}"
```

### 2.3 `.github/workflows/deploy-production.yml` — manual gate

```yaml
name: deploy-production
on:
  workflow_dispatch:
    inputs:
      sha:
        description: 'Git SHA to deploy (must already have published images)'
        required: true

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  approve:
    runs-on: ubuntu-latest
    environment: production    # requires manual approval (configure in repo settings)
    steps:
      - run: echo "Approved deployment of ${{ inputs.sha }}"

  deploy:
    needs: approve
    runs-on: ubuntu-latest
    steps:
      - name: Verify images exist
        run: |
          for app in web widget embed api; do
            docker manifest inspect ghcr.io/${{ github.repository_owner }}/csb-$app:${{ inputs.sha }} > /dev/null
          done
      - name: Trigger Coolify production deploy
        env:
          COOLIFY_URL: ${{ secrets.COOLIFY_PROD_WEBHOOK_URL }}
          COOLIFY_TOKEN: ${{ secrets.COOLIFY_PROD_API_TOKEN }}
        run: |
          curl -fsSL -X POST "$COOLIFY_URL" \
            -H "Authorization: Bearer $COOLIFY_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"env\":\"production\",\"sha\":\"${{ inputs.sha }}\"}"
      - name: Post-deploy health check
        run: |
          for url in $WEB_URL $WIDGET_URL $API_URL/health; do
            for i in {1..30}; do
              if curl -fsSL "$url" > /dev/null; then break; fi
              sleep 10
            done
          done
        env:
          WEB_URL: ${{ vars.PROD_WEB_URL }}
          WIDGET_URL: ${{ vars.PROD_WIDGET_URL }}
          API_URL: ${{ vars.PROD_API_URL }}
```

### 2.4 Why there is no `deploy-dev.yml` or `deploy-staging.yml`

`dev` and `staging` deploys are **automatic**: `release-images.yml` publishes images on every push to those branches and notifies Coolify, which redeploys. There is nothing for a human to gate. Only **production** requires a manual approval workflow (`deploy-production.yml`).

### 2.5 `.github/workflows/preview.yml` — per-PR preview (optional)

Spawns a per-PR Coolify environment when a PR has the `preview` label. Tears down on close.

---

## 3. Dockerfiles

### 3.1 `apps/web/Dockerfile` (and `apps/widget/Dockerfile`)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @csb/web build
RUN pnpm --filter @csb/web deploy --prod /out

FROM node:20-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
```

> `apps/widget/Dockerfile` is identical except the filter is `@csb/widget` and port `3001`.

> Both `apps/web/next.config.ts` and `apps/widget/next.config.ts` must set `output: 'standalone'` for this Dockerfile to work. Confirm against `node_modules/next/dist/docs/` (per project AGENTS.md — Next.js APIs may differ from training data).

### 3.2 `apps/embed/Dockerfile`

```dockerfile
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/embed apps/embed
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @csb/embed build

FROM nginx:1.27-alpine AS runtime
COPY apps/embed/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/embed/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://localhost/widget.js > /dev/null || exit 1
```

`apps/embed/nginx.conf` must serve `widget.js` with `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=86400` and `Access-Control-Allow-Origin: *` (the embed script is consumed cross-origin).

### 3.3 `apps/api/Dockerfile`

```dockerfile
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
RUN pnpm --filter @csb/api build       # tsc → apps/api/dist
RUN pnpm --filter @csb/api deploy --prod /out

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/index.js"]
```

`/health` returns `200` with `{ ok: true, mongo: 'up' | 'down', pinecone: 'up' | 'down', uptime: number }`.

---

## 4. Caching Strategy

| Layer | Mechanism | Scope |
|-------|-----------|-------|
| pnpm store | `actions/setup-node` cache + Docker BuildKit cache mount | Per-runner + per-image |
| Turborepo cache | Remote cache (Vercel Turbo or self-hosted) | Org-wide; key = file hash |
| Docker layers | `cache-from`/`cache-to` GHA scope per app | Per-app |
| Next.js `.next/cache` | Persisted via Turborepo cache outputs | Per-app |

**Required env vars on every CI job**:
- `TURBO_TOKEN` — secret (write access for `main`/`staging`/`dev`, read-only for PRs from forks)
- `TURBO_TEAM` — repo variable

---

## 5. Local Hooks

`.husky/pre-commit`:
```bash
#!/usr/bin/env sh
pnpm lint-staged
```

`.husky/pre-push`:
```bash
#!/usr/bin/env sh
pnpm turbo run type-check --filter='[HEAD]'
```

`package.json#lint-staged`:
```json
{
  "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css}": ["prettier --write"]
}
```

**Never use `--no-verify` to skip hooks** — fix the underlying issue (per project guidance).

---

## 6. Secrets & Variables

### 6.1 GitHub repository secrets

| Secret | Used By | Scope |
|--------|---------|-------|
| `TURBO_TOKEN` | All CI jobs | Read+write |
| `GITHUB_TOKEN` | release-images, security | Auto-provided |
| `COOLIFY_WEBHOOK_URL` | release-images (dev, staging) | — |
| `COOLIFY_API_TOKEN` | release-images (dev, staging) | — |
| `COOLIFY_PROD_WEBHOOK_URL` | deploy-production | Production env |
| `COOLIFY_PROD_API_TOKEN` | deploy-production | Production env |
| `GHCR_USERNAME`/`GHCR_TOKEN` | If pushing to alt registry | — |

### 6.2 GitHub repository variables

| Variable | Value |
|----------|-------|
| `TURBO_TEAM` | `team-resolve-ai` (or your team slug) |
| `DEV_WEB_URL` | `https://dev.resolve-ai.app` |
| `DEV_WIDGET_URL` | `https://widget.dev.resolve-ai.app` |
| `DEV_API_URL` | `https://api.dev.resolve-ai.app` |
| `STAGING_WEB_URL` | `https://staging.resolve-ai.app` |
| `STAGING_WIDGET_URL` | `https://widget.staging.resolve-ai.app` |
| `STAGING_API_URL` | `https://api.staging.resolve-ai.app` |
| `PROD_WEB_URL` | `https://app.resolve-ai.app` |
| `PROD_WIDGET_URL` | `https://widget.resolve-ai.app` |
| `PROD_API_URL` | `https://api.resolve-ai.app` |

### 6.3 GitHub Environments

| Environment | Required reviewers | Deployment branches |
|-------------|--------------------|---------------------|
| `dev` | none (auto-deploy) | `dev` |
| `staging` | none (auto-deploy) | `staging` |
| `production` | ≥1 reviewer + 5-minute wait timer | `main` |

---

## 7. Release Strategy

- **Versioning**: Calendar versioning `vYY.MM.DD-<short-sha>` for image tags; semver only for `packages/*` if ever published.
- **Changelog**: `release-please` action generates a release PR from conventional commits on `main`.
- **Rollback**: Coolify retains last 3 successful deployments per app. To roll back, run `deploy-production` with the previous SHA — no rebuild needed (images are immutable).

---

## 8. Failure Handling

| Failure Point | Auto Action | Manual Action |
|---------------|-------------|---------------|
| Lint/type-check fails | Block merge | Fix locally; push |
| Test fails | Block merge | Investigate flake vs real failure |
| `docker-build` fails | Block merge | Inspect cache, base image bumps |
| Image push fails | Retry once | Check GHCR quotas, auth |
| Coolify deploy fails | Notify Slack channel `#deploys` | Re-trigger via `deploy-production` |
| Post-deploy health check fails | Alert + auto-rollback via Coolify webhook | Inspect logs |

`security` job is **non-blocking** initially (`continue-on-error: true` on `audit`) until baseline is clean; flip to blocking once green.

---

## 9. Acceptance

- [ ] PR opened against `main`, `staging`, or `dev` triggers `ci.yml` and runs all 6 jobs in <8 min on cache hit
- [ ] Merge to `dev` or `staging` publishes 4 images to GHCR tagged with branch + SHA and auto-notifies Coolify
- [ ] Merge to `main` publishes images but does **not** deploy production without manual `deploy-production.yml` approval
- [ ] Production deploys cannot bypass the GitHub Environment protection rule
- [ ] Failed health check after any deploy triggers Coolify rollback
- [ ] No secrets present in image layers (verified with `dive` / `trivy`)
- [ ] All four runtime images are <250 MB
- [ ] CodeQL + gitleaks pass on every PR
- [ ] `dev`, `staging`, and `production` health-check URLs are all configured as GitHub repository variables
