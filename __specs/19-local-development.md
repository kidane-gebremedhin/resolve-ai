# 19 — Local Development Environment

## Overview

Local development uses **Docker Compose** for stateful infrastructure (MongoDB, Redis) and **`pnpm turbo dev`** for the application processes. Everything required to run the full stack on a developer machine must work from a clean `git clone` with three commands (the database starts empty — onboard via the sign-up flow, see §6):

> **Where local fits in the env chain**: `local` (your laptop, this doc) → `dev` (auto-deployed from the `dev` branch, see [20-coolify-deployment.md](./20-coolify-deployment.md) §1) → `staging` → `production`. The `local` env is for the individual developer's loop; `dev` is the shared integration env for the team. They use the same compose shape so promotion is just an image tag swap.

```bash
pnpm install
docker compose up -d
pnpm dev
```

> **Principle**: The local stack runs the **same images** Coolify ships (same Dockerfile, same Node version, same Mongo version). The only difference is hot-reload via `pnpm dev` instead of pre-built bundles.

---

## 1. Prerequisites

| Tool | Min version | How to install |
|------|-------------|----------------|
| Node.js | 20.x (pinned in `.nvmrc`) | `nvm install` or `mise install` |
| pnpm | 9.x | `corepack enable && corepack prepare pnpm@9 --activate` |
| Docker Engine | 24+ | https://docs.docker.com/engine/install/ |
| Docker Compose | v2 (`docker compose`, not `docker-compose`) | Bundled with Docker Desktop / engine |
| Git | 2.40+ | `apt install git` / `brew install git` |

Optional:

| Tool | Purpose |
|------|---------|
| `mkcert` | Local HTTPS certs (needed for testing iframe + cross-origin cookies) |
| `mongosh` | Direct DB access |
| `ngrok` / `cloudflared` | Expose local API to Paddle/Firecrawl webhooks |

---

## 2. `docker-compose.yml` (Infrastructure only — default)

For day-to-day development. Apps run on the host via `pnpm dev`; only stateful services run in Docker.

```yaml
name: csb-dev

services:
  mongo:
    image: mongo:7
    container_name: csb-mongo
    restart: unless-stopped
    ports: ['27017:27017']
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_INITDB_ROOT_USERNAME:-admin}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_INITDB_ROOT_PASSWORD:-password}
      MONGO_INITDB_DATABASE: ${MONGO_INITDB_DATABASE:-customer-support}
    volumes:
      - mongo-data:/data/db
      - ./scripts/mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro
    healthcheck:
      test: ['CMD', 'mongosh', '--quiet', '--eval', 'db.runCommand({ ping: 1 })']
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: csb-redis
    restart: unless-stopped
    ports: ['6379:6379']
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-}
    volumes: ['redis-data:/data']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 10

  mailhog:                 # SMTP capture for emails (registration, invites, reset)
    image: mailhog/mailhog:latest
    container_name: csb-mailhog
    ports:
      - '1025:1025'        # SMTP
      - '8025:8025'        # Web UI at http://localhost:8025
    restart: unless-stopped

  minio:                   # Local S3-compatible storage (optional, set STORAGE_PROVIDER=s3)
    image: minio/minio:latest
    container_name: csb-minio
    command: server /data --console-address ":9001"
    ports:
      - '9000:9000'        # S3 API
      - '9001:9001'        # Console at http://localhost:9001
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes: ['minio-data:/data']

volumes:
  mongo-data:
  redis-data:
  minio-data:
```

`scripts/mongo-init.js` creates the application user with `readWrite` on `customer-support` (avoids using root creds from the app):

```javascript
db = db.getSiblingDB('customer-support');
db.createUser({
  user: 'csb',
  pwd: 'csb-dev',
  roles: [{ role: 'readWrite', db: 'customer-support' }],
});
```

---

## 3. `docker-compose.full.yml` (Apps + Infra — Coolify smoke test)

Used to validate the production-shaped image graph locally before pushing. Mirrors the Coolify dev/staging compose (see [20-coolify-deployment.md](./20-coolify-deployment.md) §3) and is the closest you can get to the dev environment without pushing to the `dev` branch.

```yaml
name: csb-full

services:
  mongo: { extends: { file: docker-compose.yml, service: mongo } }
  redis: { extends: { file: docker-compose.yml, service: redis } }
  mailhog: { extends: { file: docker-compose.yml, service: mailhog } }

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    env_file: ['.env']
    ports: ['4000:4000']
    depends_on:
      mongo: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    env_file: ['.env']
    environment:
      NEXT_PUBLIC_API_URL: http://api:4000/api/v1
      NEXT_PUBLIC_SOCKET_URL: http://api:4000
    ports: ['3000:3000']
    depends_on: [api]
    restart: unless-stopped

  widget:
    build:
      context: .
      dockerfile: apps/widget/Dockerfile
    env_file: ['.env']
    environment:
      NEXT_PUBLIC_API_URL: http://api:4000/api/v1
      NEXT_PUBLIC_SOCKET_URL: http://api:4000
    ports: ['3001:3001']
    depends_on: [api]
    restart: unless-stopped

  embed:
    build:
      context: .
      dockerfile: apps/embed/Dockerfile
    ports: ['3002:80']
    restart: unless-stopped

volumes:
  mongo-data:
  redis-data:
```

Usage:

```bash
pnpm build
docker compose -f docker-compose.full.yml up --build
```

---

## 4. Root `package.json` Scripts

```json
{
  "scripts": {
    "dev": "turbo dev",
    "dev:infra": "docker compose up -d",
    "dev:infra:stop": "docker compose down",
    "dev:infra:reset": "docker compose down -v && docker compose up -d",
    "dev:full": "docker compose -f docker-compose.full.yml up --build",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "type-check": "turbo type-check",
    "clean": "turbo clean && rm -rf node_modules/.cache",
    "format": "prettier --write .",

    "db:migrate": "pnpm --filter @csb/api db:migrate",
    "db:seed": "pnpm --filter @csb/api db:seed",

    "verify:assets": "node scripts/verify-assets.mjs",
    "verify:env": "node scripts/verify-env.mjs",
    "prepare": "husky"
  }
}
```

| Script | When to use |
|--------|-------------|
| `pnpm dev:infra` | Start MongoDB/Redis/MailHog/MinIO (most common) |
| `pnpm dev` | Hot-reload all four apps (after `dev:infra`) |
| `pnpm dev:full` | Build and run all four apps as containers — pre-push validation |
| `pnpm db:migrate` | Sync Mongoose indexes on all models |
| `pnpm db:seed` | Seed manual-QA accounts — every role + a paid org (see §6.1) |
| `pnpm verify:assets` | Fail-fast check that every file in `apps/web/public/` is referenced |
| `pnpm verify:env` | Validate `.env` matches `.env.example` and required vars are set |

---

## 5. First-Time Setup Walkthrough

```bash
# 1. Clone
git clone git@github.com:org/customer-service-chatbot.git
cd customer-service-chatbot

# 2. Pin Node version
nvm install              # reads .nvmrc

# 3. Enable pnpm via corepack
corepack enable
corepack prepare pnpm@9 --activate

# 4. Install
pnpm install

# 5. Env files
cp .env.example .env
# Edit .env to fill in: OPENROUTER_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# PINECONE_API_KEY, PINECONE_INDEX, FIRECRAWL_API_KEY, PADDLE_* (sandbox keys)

# 6. Start infrastructure
pnpm dev:infra

# 7. Sync database indexes (database starts empty)
pnpm db:migrate

# 7b. Optional — seed manual-QA logins (all roles + a paid org). See §6.1.
pnpm db:seed

# 8. Start apps
pnpm dev
```

Visit:

| URL | What |
|-----|------|
| http://localhost:3000 | Marketing site + dashboard |
| http://localhost:3000/register | Create the first account, then add a website + agent in the UI |
| http://localhost:3001 | Widget iframe (also embedded via embed script) |
| http://localhost:3002/widget.js | Embed script |
| http://localhost:4000/health | API health |
| http://localhost:8025 | MailHog UI (captured emails) |
| http://localhost:9001 | MinIO console (S3 storage) |

---

## 6. Database State

A fresh database is empty; `pnpm db:migrate` only syncs Mongoose indexes. Onboard
the same way a real user would:

1. Register an account at `http://localhost:3000/register` (or `POST /auth/register`).
2. Create a website, then an agent, from the dashboard.
3. Configure the widget under **Widget** (`/app/widget`) and grab the install
   snippet under **Developers** (`/app/developers`).

To start from a clean database, drop the Docker volumes and re-sync indexes:

```bash
pnpm dev:infra:reset && pnpm db:migrate
```

### 6.1 Manual-QA seed (opt-in)

`pnpm db:seed` ([`apps/api/scripts/seed-test-accounts.ts`](../apps/api/scripts/seed-test-accounts.ts))
exists so role- and plan-dependent behaviour can be exercised without clicking
through sign-up five times. It is **never** run automatically — `db:migrate`
stays seed-free, and production deploys only run migrations.

It upserts (idempotently, resetting the seeded passwords on every run):

- **Acme Support Co** — an org on the **business** plan with an `active`
  `Subscription` and `plan` mirrored onto the Organization, holding one
  credentials account per membership role: `owner@acme.test`, `admin@acme.test`,
  `agent@acme.test`, `viewer@acme.test`.
- **Platform HQ** — a second org, also on the business plan, owned by
  `platformadmin@acme.test` (`role: platform_admin`). The extra org is
  deliberate: the admin app only checks the platform role, but a JWT with no
  `organizationId` 403s on every `/app` route, so the account would be unusable
  in the web app without it. It is subscribed because `apps/web`'s `/app` layout
  is a hard subscription gate — an unpaid workspace is redirected to `/checkout`,
  which put the platform admin on the plan picker rather than the dashboard.
- A Website + its Agent + WidgetSettings inside the paid org, mirroring what
  `POST /websites` provisions, so the widget works on first login.

Shared password `Test1234!` (override with `--password=`), target database from
`MONGODB_URI` or `--uri=`. The Paddle IDs are synthetic — Mongo-backed plan
gating and quotas behave correctly, but live Paddle calls (portal, plan change,
cancel) will fail for the seeded org.

---

## 7. Local HTTPS (optional but recommended)

The embed script + widget iframe rely on cross-origin cookies; some browsers (Safari, hardened Chrome) require `Secure` cookies even on localhost. Use `mkcert` for trusted local certs:

```bash
mkcert -install
mkcert localhost 127.0.0.1 ::1
mv localhost+2.pem certs/localhost.crt
mv localhost+2-key.pem certs/localhost.key
```

Update Next.js dev scripts to enable HTTPS:

```bash
# apps/web/package.json
"dev": "next dev --experimental-https --experimental-https-cert ../../certs/localhost.crt --experimental-https-key ../../certs/localhost.key"
```

> Per project AGENTS.md: verify the Next.js HTTPS flag name against `node_modules/next/dist/docs/` — Next 16 may have renamed flags.

---

## 8. Webhook Tunneling (Paddle, Firecrawl async)

Paddle webhooks and Firecrawl async callbacks need a public URL pointing at `http://localhost:4000`.

```bash
# Option A: cloudflared (free, no account)
cloudflared tunnel --url http://localhost:4000

# Option B: ngrok (account required)
ngrok http 4000
```

Set the public URL in Paddle dashboard webhook settings; in `.env` set `API_BASE_URL` to the same URL while testing webhooks.

---

## 9. Debugging Tips

| Issue | Fix |
|-------|-----|
| `MongoServerSelectionError` on `pnpm dev` | Wait for the healthcheck — `docker compose ps` should show `(healthy)` |
| Pinecone index errors | The free tier index is auto-created on first vector upsert; otherwise create via Pinecone console |
| `EADDRINUSE :3000` | A previous `pnpm dev` is still running — `pkill -f "next dev"` |
| Widget shows CORS error | `CORS_ORIGINS` in `apps/api/.env` must include the embedding page's origin |
| Stale Turbo cache | `pnpm turbo run dev --force` |
| Theme flicker on first paint | Cookie not being read — check `apps/web/src/app/layout.tsx` calls `cookies()` (App Router) |
| Pre-commit hook didn't run | `pnpm install` again to re-link Husky; never `--no-verify` |

---

## 10. Editor Setup

`.vscode/settings.json` (committed):

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "eslint.workingDirectories": [{ "pattern": "apps/*" }, { "pattern": "packages/*" }],
  "files.associations": { "*.css": "tailwindcss" }
}
```

`.vscode/extensions.json` (recommendations):
- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`
- `bradlc.vscode-tailwindcss`
- `Prisma.prisma` (if added later)
- `ms-azuretools.vscode-docker`
- `eamodio.gitlens`

---

## 11. Acceptance

- [ ] `pnpm install && pnpm dev:infra && pnpm db:migrate && pnpm dev` succeeds on a clean machine in <5 min
- [ ] All 4 apps reachable at their documented localhost ports
- [ ] Registering a new account at `/register` logs in and lands on an empty dashboard
- [ ] Sending a widget message produces an AI response within 5 s
- [ ] `pnpm dev:full` builds and runs production-shaped containers locally
- [ ] `pnpm verify:env` passes on the example `.env`
