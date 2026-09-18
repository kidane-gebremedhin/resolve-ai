---
name: coolify-three-env-deploy
description: Provision and configure three Coolify projects (dev, staging, production) for the customer-support stack — Docker compose per env, Traefik labels, TLS via Let's Encrypt, per-environment secrets. Use during Phase 0 to bring up dev, and again during Phase 4 to promote to production. Implements __specs/20-coolify-deployment.md.
---

# Coolify Three-Environment Deployment (dev / staging / production)

## When to use

- **Phase 0**: set up the `csb-dev` project first as the lowest-risk smoke test. Staging next.
- **Phase 4**: production project + DNS + secrets, immediately before the first production deploy.

## Prerequisites

- VPS provisioned (Hetzner / DigitalOcean / Linode), ≥4 vCPU / 8 GB RAM / 80 GB disk for the Coolify control plane; separate nodes for staging + production
- Coolify v4 installed: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
- Domain registered (e.g. `resolve-ai.app`) with DNS managed somewhere you control
- GHCR access token (read-only) added in Coolify → Sources → Container Registry
- For wildcards: Cloudflare API token with DNS edit permission, added to Coolify for DNS-01 challenge

## Procedure

1. **Create three Coolify projects**: `csb-dev`, `csb-staging`, `csb-production` (Projects → + New).

2. **DNS records** — see [`__specs/20-coolify-deployment.md`](../../__specs/20-coolify-deployment.md) §5 for the exact record list. Three apex/A records (`dev.resolve-ai.app`, `staging.resolve-ai.app`, `resolve-ai.app`) pointing at each node, with CNAMEs for `widget.*`, `api.*`, `embed.*` per env.

3. **Compose files** — write three files under `coolify/`:
   - `coolify/docker-compose.staging.yml` — full body in spec §3.1
   - `coolify/docker-compose.dev.yml` — staging with `dev.resolve-ai.app` hosts, `IMAGE_TAG=dev`, `mem_limit: 512m`, `restart: on-failure:3`, healthcheck `interval: 60s`, named volume `mongo-data-dev` (spec §3.2)
   - `coolify/docker-compose.production.yml` — staging with `resolve-ai.app` hosts, `mongo` service **removed** (use Atlas), `IMAGE_TAG` interpolated from deploy webhook (git SHA), `api` with `deploy.replicas: 2` + Traefik rate-limit middleware, `restart: always` (spec §3.3)

4. **Environment variable groups** (Coolify UI per project) — populate from the dev/staging/production columns of [`__specs/20-coolify-deployment.md`](../../__specs/20-coolify-deployment.md) §4.1. Every secret must be **distinct across the three envs**.

5. **Upload compose to Coolify project** → Deploy. First deploy: dev → staging → production (lowest blast radius first).

6. **Verify TLS issuance** — for each public host, `curl -sI https://<host> | head -1` returns `HTTP/2 200` or a 3xx (not a TLS error). If Let's Encrypt fails, DNS isn't propagated yet.

7. **Wire CI webhooks** — Coolify project → Webhooks → copy URL + bearer token. Add to GitHub repo secrets per [`github-actions-monorepo`](../github-actions-monorepo/):
   - `COOLIFY_WEBHOOK_URL` + `COOLIFY_API_TOKEN`: dev + staging (the branch in the payload routes to the right project)
   - `COOLIFY_PROD_WEBHOOK_URL` + `COOLIFY_PROD_API_TOKEN`: production only

8. **First deploy** — merge a no-op commit to `dev` → CI pushes images → webhook fires → Coolify pulls + rolling restarts → run end-to-end smoke per [`webapp-testing`](../webapp-testing/).

9. **Production-only**:
   - MongoDB Atlas cluster M10+ (replica set), `MONGODB_URI` is `mongodb+srv://...`
   - Backup config per spec §7 (Atlas PITR + Pinecone daily snapshot)
   - Observability sinks per spec §8 (Sentry, Better Stack / Loki, Grafana)
   - Coolify scheduled task: Pinecone snapshot daily

## Gotchas

- **DNS must point at the node before deploy** — Let's Encrypt HTTP-01 challenge will fail otherwise. Wildcards (DNS-01) need a Cloudflare token in Coolify.
- **NextAuth `NEXTAUTH_URL`** must match the exact public origin per env (`https://dev.resolve-ai.app`, `https://staging.resolve-ai.app`, `https://app.resolve-ai.app`).
- **CORS_ORIGINS** must include the widget host too (`https://widget.<env>.resolve-ai.app`) — the iframe is cross-origin to the dashboard.
- **Mongo password rotation** in prod (Atlas): update Atlas user → update `MONGODB_URI` in Coolify env → redeploy `api`. Don't forget the redeploy.
- **Coolify scaling beyond 1 `api` replica** requires the Socket.io Redis adapter (see [`socketio-realtime`](../socketio-realtime/) — spec §08 already documents this).
- **`IMAGE_TAG=latest` is forbidden** in production. Always git SHA. Mutable tags (`dev`/`staging`) are OK in their respective envs only.
- **Don't share secrets across envs**. A leaked dev secret must not grant access to staging/prod (spec §20 §4.1 rule).
- **Cloudflare Access** in front of `dev.resolve-ai.app` (and optionally `staging.resolve-ai.app`) keeps the unstable env from being publicly indexed — recommended.

## Acceptance

- [ ] Three Coolify projects exist; each has all 5–6 services healthy (`web`, `widget`, `embed`, `api`, `redis`, plus `mongo` in dev/staging)
- [ ] `https://<env>.resolve-ai.app` loads with a valid TLS cert in all three environments
- [ ] Pushing to `dev` auto-deploys within 10 min of CI start
- [ ] Pushing to `staging` auto-deploys within 10 min of CI start
- [ ] Pushing to `main` does NOT auto-deploy production — requires manual `deploy-production.yml` approval
- [ ] Production deploys are reproducible (same git SHA → same containers)
- [ ] Failed healthcheck triggers Coolify rollback within 2 min
- [ ] No secret value present in Coolify logs, container logs, or GitHub Actions logs
- [ ] Backups verified restorable in a documented drill (prod + staging only)

## Specs referenced

- [`__specs/20-coolify-deployment.md`](../../__specs/20-coolify-deployment.md) — full topology, compose, secrets, DNS, deploy flow, backups, observability, setup checklist, acceptance
- [`__specs/18-cicd-pipeline.md`](../../__specs/18-cicd-pipeline.md) §2.2 — webhook payload shape
- [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) — full env var catalogue
- [`__specs/08-socketio-design.md`](../../__specs/08-socketio-design.md) §"Multi-server deployment" — Redis adapter for `api` replicas > 1
