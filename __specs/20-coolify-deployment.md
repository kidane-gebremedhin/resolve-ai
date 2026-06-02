# 20 — Coolify Deployment

## Overview

Coolify is the **self-hosted PaaS** that runs the production and staging environments. It pulls images from **GHCR** (published by CI — see [18-cicd-pipeline.md](./18-cicd-pipeline.md)), runs them under a managed Traefik reverse proxy, and handles TLS via Let's Encrypt.

> **Principle**: Coolify manages **runtime** (containers, networking, TLS, secrets, restart policy, health checks). CI manages **build** (images, tests, scans). The two are decoupled by GHCR + a webhook.

---

## 1. Topology

```
                    ┌──────────────────────────┐
                    │   Coolify Control Plane  │   (1× VPS, ≥2 vCPU / 4 GB RAM)
                    │   /coolify-data (volume) │   Hosts Coolify itself + Postgres
                    └────────────┬─────────────┘
                                 │ SSH / Docker API
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
┌───────▼────────┐      ┌────────▼───────┐       ┌────────▼───────┐
│   Dev Node     │      │  Staging Node  │       │  Production    │
│  2 vCPU / 4 GB │      │  4 vCPU / 8 GB │       │  Node Cluster  │
│                │      │                │       │  8 vCPU / 16GB │
│  Traefik       │      │  Traefik       │       │  Traefik       │
│  ├─ web        │      │  ├─ web        │       │  ├─ web        │
│  ├─ widget     │      │  ├─ widget     │       │  ├─ widget     │
│  ├─ embed      │      │  ├─ embed      │       │  ├─ embed      │
│  ├─ api        │      │  ├─ api        │       │  ├─ api (×2)   │
│  ├─ mongo      │      │  ├─ mongo      │       │  ├─ mongo (RS) │
│  └─ redis      │      │  └─ redis      │       │  └─ redis      │
└────────────────┘      └────────────────┘       └────────────────┘
```

| Environment | Branch | Domains | DB | Image tag pattern |
|-------------|--------|---------|----|--------------------|
| Dev | `dev` | `dev.customer-service-chatbot.app`, `widget.dev.customer-service-chatbot.app`, `api.dev.customer-service-chatbot.app`, `embed.dev.customer-service-chatbot.app` | Single-node Mongo 7 (Coolify-managed) | `ghcr.io/<org>/csb-*:dev` (mutable, redeployed on every `dev` push) |
| Staging | `staging` | `staging.customer-service-chatbot.app`, `widget.staging.customer-service-chatbot.app`, `api.staging.customer-service-chatbot.app`, `embed.staging.customer-service-chatbot.app` | Single-node Mongo 7 (Coolify-managed) | `ghcr.io/<org>/csb-*:staging` (mutable) |
| Production | `main` | `app.customer-service-chatbot.app`, `widget.customer-service-chatbot.app`, `api.customer-service-chatbot.app`, `embed.customer-service-chatbot.app` | MongoDB Atlas M10+ **OR** self-hosted Mongo replica set | `ghcr.io/<org>/csb-*:<git-sha>` (immutable, requires manual deploy approval) |

> The **dev** environment is for the internal team to integrate work-in-progress from feature branches that have landed on `dev`; it is unstable by design and may be wiped/reset at any time.
> **Staging** mirrors production shape (TLS, secrets management, observability) but on a smaller node and with sandbox third-party credentials.
> Production must use **MongoDB Atlas** or a self-hosted replica set — a single-node Mongo is acceptable for dev and staging only.

> **Cost-optimization option**: dev + staging can share a single Coolify node (separate projects, separate Traefik routers). Keep production on its own node for blast-radius isolation.

---

## 2. Coolify Project Layout

Create **one project per environment** in Coolify (`Projects` → `+ New`):

- `csb-dev`
- `csb-staging`
- `csb-production`

Each project contains **5 resources**:

| Resource | Type | Image | Health |
|----------|------|-------|--------|
| `web` | Docker Image | `ghcr.io/<org>/csb-web:<tag>` | `GET /api/health` |
| `widget` | Docker Image | `ghcr.io/<org>/csb-widget:<tag>` | `GET /api/health` |
| `embed` | Docker Image | `ghcr.io/<org>/csb-embed:<tag>` | `GET /widget.js` |
| `api` | Docker Image | `ghcr.io/<org>/csb-api:<tag>` | `GET /health` |
| `mongo` | Database (staging) **or** External (prod, Atlas) | `mongo:7` | Built-in |
| `redis` | Database | `redis:7-alpine` | Built-in |

**Why "Docker Image" instead of "Git source"**: CI builds images deterministically and runs the security/test gates. If Coolify built from git, it would bypass those gates and the staging/prod environments could diverge.

---

## 3. Coolify Compose Override

Coolify can ingest a `docker-compose.yml` to define multiple resources at once. Store these under `coolify/`, one file per environment:

- `coolify/docker-compose.dev.yml`
- `coolify/docker-compose.staging.yml`
- `coolify/docker-compose.production.yml`

The three files differ only in: image tag pattern, public hostnames, replica counts, and whether `mongo` is in-compose (dev/staging) or external (production). The staging file is shown below in full; dev and production are described as diffs.

### 3.1 `coolify/docker-compose.staging.yml`

```yaml
# Coolify reads this when you choose "Docker Compose" deployment type.
# Image tags are interpolated from the GitHub webhook payload.
version: '3.9'

services:
  api:
    image: ghcr.io/${GHCR_OWNER}/csb-api:${IMAGE_TAG}
    restart: unless-stopped
    env_file: ['.env']
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=Host(`api.staging.customer-service-chatbot.app`)
      - traefik.http.routers.api.entrypoints=websecure
      - traefik.http.routers.api.tls.certresolver=letsencrypt
      - traefik.http.services.api.loadbalancer.server.port=4000
      - traefik.http.middlewares.api-cors.headers.accesscontrolalloworiginlist=https://staging.customer-service-chatbot.app,https://widget.staging.customer-service-chatbot.app
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:4000/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    depends_on:
      mongo: { condition: service_healthy }
      redis: { condition: service_healthy }

  web:
    image: ghcr.io/${GHCR_OWNER}/csb-web:${IMAGE_TAG}
    restart: unless-stopped
    env_file: ['.env']
    environment:
      NEXT_PUBLIC_API_URL: https://api.staging.customer-service-chatbot.app/api/v1
      NEXT_PUBLIC_SOCKET_URL: https://api.staging.customer-service-chatbot.app
      NEXT_PUBLIC_WIDGET_URL: https://widget.staging.customer-service-chatbot.app
      NEXT_PUBLIC_EMBED_URL: https://embed.staging.customer-service-chatbot.app/widget.js
      NEXT_PUBLIC_APP_URL: https://staging.customer-service-chatbot.app
      NEXTAUTH_URL: https://staging.customer-service-chatbot.app
    labels:
      - traefik.enable=true
      - traefik.http.routers.web.rule=Host(`staging.customer-service-chatbot.app`)
      - traefik.http.routers.web.entrypoints=websecure
      - traefik.http.routers.web.tls.certresolver=letsencrypt
      - traefik.http.services.web.loadbalancer.server.port=3000
    depends_on: [api]

  widget:
    image: ghcr.io/${GHCR_OWNER}/csb-widget:${IMAGE_TAG}
    restart: unless-stopped
    env_file: ['.env']
    environment:
      NEXT_PUBLIC_API_URL: https://api.staging.customer-service-chatbot.app/api/v1
      NEXT_PUBLIC_SOCKET_URL: https://api.staging.customer-service-chatbot.app
    labels:
      - traefik.enable=true
      - traefik.http.routers.widget.rule=Host(`widget.staging.customer-service-chatbot.app`)
      - traefik.http.routers.widget.entrypoints=websecure
      - traefik.http.routers.widget.tls.certresolver=letsencrypt
      - traefik.http.services.widget.loadbalancer.server.port=3001
      - traefik.http.middlewares.widget-csp.headers.contentsecuritypolicy=frame-ancestors *
    depends_on: [api]

  embed:
    image: ghcr.io/${GHCR_OWNER}/csb-embed:${IMAGE_TAG}
    restart: unless-stopped
    labels:
      - traefik.enable=true
      - traefik.http.routers.embed.rule=Host(`embed.staging.customer-service-chatbot.app`)
      - traefik.http.routers.embed.entrypoints=websecure
      - traefik.http.routers.embed.tls.certresolver=letsencrypt
      - traefik.http.services.embed.loadbalancer.server.port=80
      - traefik.http.middlewares.embed-cors.headers.accesscontrolalloworiginlist=*

  mongo:
    image: mongo:7
    restart: unless-stopped
    volumes: ['mongo-data:/data/db']
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_INITDB_ROOT_USERNAME}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_INITDB_ROOT_PASSWORD}
    healthcheck:
      test: ['CMD', 'mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 })']
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes: ['redis-data:/data']
    healthcheck:
      test: ['CMD', 'redis-cli', '-a', '${REDIS_PASSWORD}', 'ping']
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  mongo-data:
  redis-data:
```

### 3.2 `coolify/docker-compose.dev.yml`

Differences from staging:

- All `*.staging.customer-service-chatbot.app` → `*.dev.customer-service-chatbot.app`
- All `NEXT_PUBLIC_*_URL`, `NEXTAUTH_URL`, `CORS_ORIGINS` updated to `dev.customer-service-chatbot.app` hosts
- `IMAGE_TAG` defaults to `dev` (mutable — every push to the `dev` branch redeploys)
- Smaller resource limits (Coolify per-service resource constraints): `mem_limit: 512m` per app
- `restart: on-failure:3` instead of `unless-stopped` — dev is allowed to crash-loop without paging
- Reduced healthcheck cadence: `interval: 60s` (saves CPU)
- `mongo` kept in-compose (single node, no replica set); volume is named `mongo-data-dev` to avoid colliding with staging if co-hosted

### 3.3 `coolify/docker-compose.production.yml`

Differences from staging:

- All `*.staging.customer-service-chatbot.app` → bare `customer-service-chatbot.app`/`*.customer-service-chatbot.app`
- `mongo` service **removed** — production uses external MongoDB Atlas, `MONGODB_URI` points at the Atlas connection string
- `IMAGE_TAG` is a full git SHA (injected by `deploy-production.yml` — never `latest`, never branch name)
- `api` runs with `deploy: replicas: 2` for HA (Coolify v4+ supports replica counts; otherwise scale via UI)
- Adds Traefik rate-limit middleware on `api`:
  ```yaml
  - traefik.http.middlewares.api-ratelimit.ratelimit.average=100
  - traefik.http.middlewares.api-ratelimit.ratelimit.burst=200
  - traefik.http.routers.api.middlewares=api-ratelimit@docker
  ```
- `restart: always` (not `unless-stopped`) — production must always come back after a node restart

---

## 4. Secrets & Environment Variables

Coolify stores env vars **encrypted at rest** and injects them at runtime. Never commit secrets.

### 4.1 Per-environment variable groups (Coolify UI)

Create one **shared environment variable group** per project and attach it to every service:

| Variable | Dev | Staging | Production |
|----------|-----|---------|------------|
| `NODE_ENV` | `development` | `staging` | `production` |
| `GHCR_OWNER` | `<github-org>` | `<github-org>` | `<github-org>` |
| `IMAGE_TAG` | `dev` (mutable) | `staging` (mutable) | `<git-sha>` (immutable, set by deploy webhook) |
| `MONGODB_URI` | `mongodb://csb:***@mongo:27017/customer-support` | `mongodb://csb:***@mongo:27017/customer-support` | `mongodb+srv://...@<atlas-cluster>/customer-support?retryWrites=true&w=majority` |
| `REDIS_URL` | `redis://:****@redis:6379` | `redis://:****@redis:6379` | `redis://:****@redis:6379` |
| `JWT_SECRET` | (256-bit, distinct) | (256-bit, distinct from dev + prod) | (256-bit, distinct, rotate quarterly) |
| `NEXTAUTH_SECRET` | (distinct) | (distinct) | (distinct) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sandbox OAuth client | Sandbox OAuth client (separate from dev) | Production OAuth client |
| `OPENROUTER_API_KEY` | Shared dev key | Shared dev key | Production key (separate project in OpenRouter) |
| `EMBEDDING_API_KEY` | Same as OpenRouter | Same | Production |
| `PINECONE_API_KEY`, `PINECONE_INDEX` | `csb-dev` index | `csb-staging` index | `csb-prod` index |
| `FIRECRAWL_API_KEY` | Sandbox | Sandbox | Production |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | `sandbox` keys | `sandbox` keys | `production` keys |
| `PADDLE_ENVIRONMENT` | `sandbox` | `sandbox` | `production` |
| `SMTP_*` | MailHog | Mailtrap | SES / Resend / Postmark |
| `STORAGE_PROVIDER` | `s3` (MinIO) | `s3` (MinIO) | `s3` (AWS / R2) |
| `AWS_*` | MinIO local | MinIO local | Real |
| `CORS_ORIGINS` | `https://dev.customer-service-chatbot.app,https://widget.dev.customer-service-chatbot.app` | `https://staging.customer-service-chatbot.app,https://widget.staging.customer-service-chatbot.app` | `https://app.customer-service-chatbot.app,https://widget.customer-service-chatbot.app` |
| `MONGO_INITDB_ROOT_PASSWORD`, `REDIS_PASSWORD` | Generated 32-char | Generated 32-char | Generated 32-char |
| `SENTRY_ENVIRONMENT` | `dev` | `staging` | `production` |

**Rule**: every secret must be **distinct across environments**. A dev secret leaking must not give access to staging or production data.

Full variable catalogue lives in [13-env-variables.md](./13-env-variables.md). The Coolify "Secrets" tab is the source of truth — `.env.example` is documentation only.

### 4.2 Secret rotation

| Secret | Rotation cadence | Procedure |
|--------|------------------|-----------|
| `JWT_SECRET` | Quarterly | Stage both old + new in code (`acceptedSecrets[]`), deploy, wait for refresh window, drop old |
| Mongo passwords | Quarterly | Update Atlas user → update Coolify env → redeploy `api` |
| Paddle webhook secret | On suspected leak | Update in Paddle dashboard + Coolify env |
| OAuth client secrets | Annually or on leak | Issue new in provider, swap in Coolify |
| OpenRouter / Pinecone / Firecrawl keys | Annually or on leak | Issue new in provider, swap, revoke old |

---

## 5. Domains & TLS

Coolify's bundled Traefik handles TLS automatically via **Let's Encrypt** (HTTP-01 challenge). Wildcards (`*.customer-service-chatbot.app`, `*.dev.customer-service-chatbot.app`, `*.staging.customer-service-chatbot.app`) require DNS-01 challenge — configure Cloudflare/Route53 token in Coolify if you need them.

**Production**

| Domain | Maps to | Notes |
|--------|---------|-------|
| `customer-service-chatbot.app` | (apex redirect) | Redirect to `https://app.customer-service-chatbot.app` |
| `app.customer-service-chatbot.app` | `web` | NextAuth requires this exact host in `NEXTAUTH_URL` |
| `widget.customer-service-chatbot.app` | `widget` | Allowed to be embedded in any iframe (`frame-ancestors *` CSP) |
| `api.customer-service-chatbot.app` | `api` | CORS allowlist driven by `CORS_ORIGINS` + per-website `allowedOrigins` |
| `embed.customer-service-chatbot.app` | `embed` | Serves `widget.js`; CDN-cached |

**Staging** (same shape, `staging.` infix)

| Domain | Maps to |
|--------|---------|
| `staging.customer-service-chatbot.app` | `web` (staging) |
| `widget.staging.customer-service-chatbot.app` | `widget` (staging) |
| `api.staging.customer-service-chatbot.app` | `api` (staging) |
| `embed.staging.customer-service-chatbot.app` | `embed` (staging) |

**Dev** (same shape, `dev.` infix)

| Domain | Maps to |
|--------|---------|
| `dev.customer-service-chatbot.app` | `web` (dev) |
| `widget.dev.customer-service-chatbot.app` | `widget` (dev) |
| `api.dev.customer-service-chatbot.app` | `api` (dev) |
| `embed.dev.customer-service-chatbot.app` | `embed` (dev) |

Add these DNS records before first deploy:

```
# Production
A     customer-service-chatbot.app                          → <prod-node-ipv4>
CNAME app.customer-service-chatbot.app                      → customer-service-chatbot.app
CNAME widget.customer-service-chatbot.app                   → customer-service-chatbot.app
CNAME api.customer-service-chatbot.app                      → customer-service-chatbot.app
CNAME embed.customer-service-chatbot.app                    → customer-service-chatbot.app

# Staging (point at staging node IP; can share with dev to save cost)
A     staging.customer-service-chatbot.app                  → <staging-node-ipv4>
CNAME widget.staging.customer-service-chatbot.app           → staging.customer-service-chatbot.app
CNAME api.staging.customer-service-chatbot.app              → staging.customer-service-chatbot.app
CNAME embed.staging.customer-service-chatbot.app            → staging.customer-service-chatbot.app

# Dev
A     dev.customer-service-chatbot.app                      → <dev-node-ipv4>
CNAME widget.dev.customer-service-chatbot.app               → dev.customer-service-chatbot.app
CNAME api.dev.customer-service-chatbot.app                  → dev.customer-service-chatbot.app
CNAME embed.dev.customer-service-chatbot.app                → dev.customer-service-chatbot.app
```

> Without DNS pointing at the node, the Let's Encrypt HTTP-01 challenge will fail and Coolify will surface a TLS error.
> **Optional**: protect `dev.customer-service-chatbot.app` (and `staging.customer-service-chatbot.app` if desired) behind a Cloudflare Access policy or HTTP Basic auth at Traefik so the unstable env isn't publicly indexed.

---

## 6. Deployment Flow

### Dev (`dev` branch) — auto-deploy on push

```
Push to dev
   │
   ▼
CI runs lint/type-check/test/build/docker-build (ci.yml)
   │
   ▼
release-images.yml publishes ghcr.io/<org>/csb-*:dev and :<git-sha>
   │
   ▼
CI POSTs to COOLIFY_WEBHOOK_URL: { env: 'dev', sha, branch: 'dev' }
   │
   ▼
Coolify pulls :dev tag (or :<sha> if pinned), rolling restarts
```

### Staging (`staging` branch) — auto-deploy on push

Identical to dev, but `env: 'staging'` and the staging Coolify project pulls `:staging`.

### Production (`main` branch) — manual approval required

```
Push to main
   │
   ▼
CI runs lint/type-check/test/build/docker-build (ci.yml)
   │
   ▼
release-images.yml publishes ghcr.io/<org>/csb-*:main and :<git-sha>
   │
   ▼
Engineer manually runs `deploy-production.yml` workflow with the desired SHA
   │
   ▼
GitHub Environment "production" gates on a reviewer + 5-min wait
   │
   ▼
CI POSTs to COOLIFY_PROD_WEBHOOK_URL: { env: 'production', sha: <git-sha> }
   │
   ▼
Coolify pulls ghcr.io/<org>/csb-<app>:<git-sha> for each service
   │
   ▼
Coolify rolling restart (1 container at a time, waits for healthcheck)
   │
   ▼
Post-deploy: GitHub Actions hits /health endpoints; on failure → trigger Coolify rollback
```

Coolify retains the **last 3 successful deployments** per environment. Rollback in dev/staging is one click in the UI; for production prefer a re-run of `deploy-production.yml` with the previous SHA so the rollback is recorded in the GitHub audit log.

---

## 7. Backups

| What | Tool | Cadence | Retention |
|------|------|---------|-----------|
| MongoDB (prod) | Atlas continuous PITR | Continuous | 7 days |
| MongoDB (staging) | `mongodump` cron via Coolify scheduled task | Daily 02:00 UTC | 7 days |
| MongoDB (dev) | — | — | Not backed up (ephemeral; recreated empty via `pnpm db:migrate`) |
| Pinecone (prod + staging) | Daily export to S3 via Coolify scheduled task running `apps/api/scripts/pinecone-snapshot.ts` | Daily | 14 days |
| Pinecone (dev) | — | — | Not backed up |
| Object storage (S3/R2) | Versioning + lifecycle rules at the provider | Continuous | 30 days (prod/staging) / 7 days (dev) |
| Coolify config | Coolify built-in DB backup → S3 | Daily | 14 days |
| `.env` snapshots | Stored in 1Password / Bitwarden | On each rotation | Last 5 |

**Test restore quarterly**: spin up a fresh staging from yesterday's backup; smoke-test signin + chat flow.

---

## 8. Observability

Coolify exposes container logs in its UI. For production, ship to a centralized backend:

| Signal | Tool | Sink |
|--------|------|------|
| Container stdout/stderr | Vector (sidecar) or Coolify's built-in Fluentbit | Better Stack / Grafana Loki |
| Metrics | `prom-client` in API; Coolify Node Exporter | Grafana Cloud (free tier) |
| APM | OpenTelemetry from `apps/api` (Express auto-instrumentation) | Honeycomb / Tempo |
| Errors | Sentry (Next.js + Express SDKs) | `sentry.io` project per env |
| Uptime | Better Stack / UptimeRobot pinging `/health` | Slack + PagerDuty |

The API exposes `/metrics` on port `9090` (Prometheus format) gated by `METRICS_TOKEN`; Coolify scrapes it via Traefik internal label.

---

## 9. Scaling

| Surface | Bottleneck | Scale step |
|---------|------------|------------|
| `api` (Socket.io + HTTP) | CPU on AI streaming; sticky sessions | Vertical first; then horizontal with Redis adapter (already specced in [08-socketio-design.md](./08-socketio-design.md) §"Multi-server deployment") |
| `web` (Next SSR) | Memory per render | Add replicas (2 → 4) |
| `widget` | Same | Replicas |
| `embed` (nginx) | Trivial; CDN-cacheable | Front with Cloudflare; origin replicas only for failover |
| MongoDB | Read/write IOPS, working set | Atlas: scale tier; self-hosted: replica set + read preference |
| Pinecone | Throughput | Increase pod size / serverless cell |

Coolify v4 supports replica counts on resources (UI: Settings → Replicas). When scaling `api` past 1 replica, **enable the Socket.io Redis adapter** so events broadcast across instances.

---

## 10. Disaster Recovery

| Scenario | Recovery |
|----------|----------|
| Coolify control plane lost | Coolify backup → restore on new VPS (≤30 min) |
| Production node lost | Spin up new node; Coolify re-points DNS via API; pull latest images |
| MongoDB corruption | Atlas PITR restore to last good moment |
| Bad deploy | Rollback to previous SHA via `deploy-production.yml` |
| All Pinecone data lost | Re-embed from KB sources (MongoDB has the source-of-truth content) |

**RPO**: ≤5 minutes (Atlas PITR) for relational data; ≤24 h for Pinecone (re-embed from Mongo).
**RTO**: ≤30 minutes for full stack rebuild.

---

## 11. Initial Setup Checklist

- [ ] Provision Coolify VPS (Hetzner / DigitalOcean / Linode), 4 vCPU / 8 GB / 80 GB minimum
- [ ] Install Coolify v4: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
- [ ] Configure SSH key for Coolify → target nodes
- [ ] In Coolify: create projects `csb-dev`, `csb-staging`, and `csb-production`
- [ ] Add GHCR private registry credentials (Coolify → Sources → Container Registry)
- [ ] Add Cloudflare API token for wildcard DNS-01 challenge (optional)
- [ ] Create environment-variable groups per §4.1; paste secrets (one set per env — never reuse across envs)
- [ ] Upload `coolify/docker-compose.dev.yml` to dev project; deploy first (lowest risk)
- [ ] Verify all five healthchecks pass on dev; smoke-test `https://dev.customer-service-chatbot.app`
- [ ] Repeat with `coolify/docker-compose.staging.yml` → `csb-staging`
- [ ] Repeat with `coolify/docker-compose.production.yml` → `csb-production`
- [ ] Point DNS records per §5 for all three environments
- [ ] Wait for TLS issuance on each host
- [ ] Add Coolify webhook URLs + API tokens to GitHub repository secrets:
  - `COOLIFY_WEBHOOK_URL`, `COOLIFY_API_TOKEN` (used for **dev + staging**; branch in payload routes)
  - `COOLIFY_PROD_WEBHOOK_URL`, `COOLIFY_PROD_API_TOKEN` (production only)
- [ ] Trigger first deploys by merging to `dev`, then `staging`
- [ ] Run end-to-end smoke on each env (signin → start widget conversation → AI reply → resolve)
- [ ] Configure backups per §7 (no backups required for dev)
- [ ] Enable observability sinks per §8 (consider sending dev errors to a separate Sentry project to avoid noise)
- [ ] Document break-glass procedure (who has Coolify root access; how to rotate it)
- [ ] Decide and document the dev-reset cadence (e.g. weekly `pnpm dev:infra:reset && pnpm db:migrate` cron in Coolify)

---

## 12. Acceptance

- [ ] Pushing to `dev` results in a deployed dev environment within 10 minutes of CI start
- [ ] Pushing to `staging` results in a deployed staging environment within 10 minutes of CI start
- [ ] Pushing to `main` produces images but does **not** deploy production without manual approval
- [ ] Production deploys are reproducible (same SHA → same containers)
- [ ] All four services pass their healthchecks within 30 s of start in every environment
- [ ] TLS certificates auto-renew without manual intervention on all three environments
- [ ] A failed deploy auto-rolls back within 2 minutes of healthcheck failure
- [ ] No secret value appears in Coolify logs, container logs, or GitHub logs
- [ ] Secrets are distinct across dev / staging / production (verified by inspection)
- [ ] Backups verified restorable in a documented quarterly drill (prod + staging)
