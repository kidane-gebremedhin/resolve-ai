# Runbook

Step-by-step instructions for setting up, running, and operating the Customer Service Chatbot monorepo (4 apps + shared packages, orchestrated by Turborepo + pnpm, with Docker-backed infrastructure).

## 0. Apps

| App | Path | Tech | Dev port | Responsibility |
|---|---|---|---|---|
| **API** | [`apps/api`](apps/api) | Express + TS + Mongoose + Socket.io | `4000` | All data access, auth (JWT), the AI agent + tools, KB ingestion (Firecrawl/Pinecone), widget endpoints, billing + webhooks, admin. Serves `/api/v1/*`, `/health`, Socket.io. |
| **Web** | [`apps/web`](apps/web) | Next.js 16 (App Router) | `3000` | Three surfaces in one app via route groups: `(marketing)` public site, `(dashboard)/app` operator dashboard, `(admin)/admin` platform admin. NextAuth (Google + credentials). |
| **Widget** | [`apps/widget`](apps/widget) | Next.js 16 | `3001` | The customer chat UI rendered inside the embed iframe (state machine, Socket.io, pre-chat/contact capture, attachments). |
| **Embed** | [`apps/embed`](apps/embed) | Vite (vanilla TS) | `3002` | `widget.js` loader: reads `data-*`, fetches appearance by `agentId`, injects the widget iframe + postMessage bridge. Library build → only `dist/widget.js`. |
| **Admin** | [`apps/admin`](apps/admin) | Next.js 16 | `3003` | Standalone **platform-admin portal** (dashboard, organizations, agents, users, subscriptions, analytics, marketing campaigns, system preferences). Same design as `/app`; talks to the same API. Gated to `platform_admin`. |

**Data stores:** MongoDB (`customer-support` db) · Pinecone (`customer-support-chatbot` index — KB vectors) · local disk or MinIO (uploads) · optional Redis (socket scaling).

**Per-environment URLs:** no host is hardcoded in source — every URL comes from env. Local values live in `.env`/`.env.local`; deployed environments copy [`.env.development.example`](.env.development.example) / [`.env.staging.example`](.env.staging.example) / [`.env.production.example`](.env.production.example). `NEXT_PUBLIC_*`/`VITE_*` are inlined at **build** time (rebuild web/widget/embed after changing them); API vars are runtime.

**Access model:** new signups are sent to `/checkout`; the `/app` dashboard is hard-gated until a Paddle subscription is `active` (`GET /billing/subscription` → `active`). Platform admin = `User.role === "platform_admin"`. Plans are admin-editable (System Preferences → Plans, served by `GET /billing/plans`).

### Accessing the admin portal

The platform-admin portal is the standalone **`apps/admin`** app (dev: **http://localhost:3003**, prod: the `admin.<host>` you configure). It's gated to users whose `User.role` is `platform_admin`; everyone else gets a 404.

1. **Run it:** included in `pnpm dev`, or `pnpm --filter @csb/admin dev` (port 3003). It needs the API (`apps/api`) running.
2. **Grant yourself admin** — the DB ships with no admins, so promote a registered user once via Mongo:
   ```bash
   mongosh "$MONGODB_URI" --eval 'db.users.updateOne({ email: "you@example.com" }, { $set: { role: "platform_admin" } })'
   ```
   (Register the account first through the normal web signup, or `POST /api/v1/auth/register`.)
3. **Sign in** at http://localhost:3003/login with that account (credentials or Google). You land on the admin dashboard.
4. **Sections:** Dashboard · Analytics · Organizations · Agents · Users · Subscriptions · **Campaigns** (create marketing campaigns; share signup links with `?campaign=<code>` and track attributed signups + paid conversions) · **System Preferences** (global app font, plans, SMTP, security, limits, affiliate program).

> The admin portal calls the same `/admin/*` API endpoints (all `requireAuth + requirePlatformAdmin`). The legacy in-`apps/web` `/admin` routes still exist; the standalone app is the primary admin surface.

## 1. Prerequisites

Install the following on your machine before you begin:

| Tool | Version | Check |
|------|---------|-------|
| Node.js | `>= 20` | `node -v` |
| pnpm | `>= 9` | `pnpm -v` |
| Docker + Compose v2 | latest | `docker compose version` |
| Git | any recent | `git --version` |

If `pnpm` is missing: `corepack enable && corepack prepare pnpm@9.15.0 --activate`.

## 2. Clone & install

```bash
git clone <repo-url>
cd customer-service-chatbot
pnpm install
```

`pnpm install` hydrates every workspace under [`apps/`](apps/) and [`packages/`](packages/).

## 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

- `JWT_SECRET`, `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials (dashboard login)
- `OPENROUTER_API_KEY`, `EMBEDDING_API_KEY` — AI providers
- `PINECONE_API_KEY`, `PINECONE_INDEX` — vector store (KB)
- `FIRECRAWL_API_KEY` — website ingestion (Phase 3+)
- `PADDLE_*` — billing (Phase 4+; leave as `pdl_xxx` placeholders if not testing billing yet)

Validate the file before continuing:

```bash
pnpm verify:env
```

## 4. Start local infrastructure

Brings up MongoDB, Redis, MailHog, and MinIO via Docker.

```bash
pnpm dev:infra
```

| Service | Port | Notes |
|---------|------|-------|
| MongoDB | `27017` | app user created via [`scripts/mongo-init.js`](scripts/mongo-init.js) |
| Redis | `6379` | password from `REDIS_PASSWORD` |
| MailHog SMTP | `1025` | UI at [http://localhost:8025](http://localhost:8025) |
| MinIO(Self hosted alternative to S3) | `9000` / `9001` | console at [http://localhost:9001](http://localhost:9001), `minioadmin` / `minioadmin` |

Stop with `pnpm dev:infra:stop`. Wipe volumes with `pnpm dev:infra:reset`.

## 5. Initialize the database

```bash
pnpm db:migrate   # syncs Mongoose indexes AND applies any unapplied data migrations
```

`db:migrate` is the single migration command. It (1) `syncIndexes()` on every model
(idempotent) and (2) runs each data migration in `apps/api/src/migrations/` not yet
recorded in the `schemamigrations` ledger, in order, recording each after it succeeds —
so re-running only applies what's new. **Run it on every deploy.** To add a migration:
drop a module in `apps/api/src/migrations/` (`NNN-name.ts` exporting a `Migration`) and
append it to `src/migrations/index.ts` — no new package script.

The database starts empty. Create your first account through the dashboard
sign-up flow (or `POST /auth/register` on the API), then add a website and agent
from the UI. To start over from a clean database, wipe the infra volumes and
re-run the migration:

```bash
pnpm dev:infra:reset   # drop Docker volumes (including Mongo) and restart
pnpm db:migrate
```

### 5.1 Seed manual-QA accounts (optional)

For manual testing you usually want one login per role plus a workspace that is
already on a paid plan. `db:seed` creates exactly that:

```bash
pnpm db:seed
```

It writes, idempotently (re-running upserts and **resets every seeded password**,
so the printed credentials are always the live ones):

| Account | Platform role | Org role | Organization |
|---------|---------------|----------|--------------|
| `owner@acme.test` | `user` | `owner` | Acme Support Co (**business** plan) |
| `admin@acme.test` | `user` | `admin` | Acme Support Co |
| `agent@acme.test` | `user` | `agent` | Acme Support Co |
| `viewer@acme.test` | `user` | `viewer` | Acme Support Co |
| `platformadmin@acme.test` | `platform_admin` | `owner` | Platform HQ (**business** plan) |

Shared password: `Test1234!` (override with `--password=...`; it must satisfy the
API's strength policy — ≥8 chars with lower, upper, number, and special).

Alongside the accounts it creates an `active` **business** `Subscription`,
mirrors `plan` onto the Organization (so plan gates and quota middleware pass),
and provisions a Website + its Agent + WidgetSettings so the widget is testable
immediately.

Notes:

- The platform admin gets its own **Platform HQ** org on purpose. The admin app
  only needs the `platform_admin` role, but without a membership the JWT carries
  no `organizationId` and every `/app` route 403s with "No organization context
  in token." Platform HQ is subscribed for the same reason: `/app` is a hard
  subscription gate, so an unpaid workspace redirects to `/checkout` and the
  account lands on the plan picker instead of the dashboard.
- The Paddle identifiers are **synthetic**. Plan gating, quotas, and the billing
  summary all read from Mongo and work; anything that calls Paddle live
  (customer portal, upgrade/downgrade, cancel) will fail for the seeded orgs. Run
  a real sandbox checkout if you need to exercise those paths — see
  [§13](#13-paddle-billing--sandbox-vs-production).
- Use these accounts to exercise **role gating**: the dashboard hides write
  actions the caller's membership role can't perform (see
  [`apps/web/src/lib/permissions.ts`](apps/web/src/lib/permissions.ts)). Signed in
  as `agent@acme.test` there is no "Add website" button; as `viewer@acme.test`
  the Inbox composer is replaced by a read-only notice.
- The connection string comes from `MONGODB_URI` (env or `.env`), or pass
  `--uri=<url>` to target another database, e.g. a shared staging cluster:
  `pnpm db:seed -- --uri="mongodb+srv://…"`.
- **`mongodb+srv://` URI hangs or fails with `querySrv ECONNREFUSED`?** Node
  resolves SRV records through its own resolver (`dns.getServers()`), not the OS
  one, so a host whose Node resolver is a stub (e.g. `127.0.0.1`) can't look up
  Atlas even when `nslookup` works. Use the non-SRV seed-list form instead —
  read the shard hosts from the `_mongodb._tcp.<cluster>` SRV record and
  `replicaSet`/`authSource` from the cluster's TXT record:
  `mongodb://<user>:<pass>@<shard-00>:27017,<shard-01>:27017,<shard-02>:27017/<db>?ssl=true&replicaSet=<rs>&authSource=admin`.

## 6. Start the apps

Single command runs all four apps in parallel via Turborepo:

```bash
pnpm dev
```

| App | URL | Workspace |
|-----|-----|-----------|
| Web dashboard | [http://localhost:3000](http://localhost:3000) | [`apps/web`](apps/web) |
| Customer widget | [http://localhost:3001](http://localhost:3001) | [`apps/widget`](apps/widget) |
| Embed loader | [http://localhost:3002](http://localhost:3002) | [`apps/embed`](apps/embed) |
| API + Socket.io | [http://localhost:4000](http://localhost:4000) | [`apps/api`](apps/api) |

To run a single app, filter by workspace name:

```bash
pnpm --filter @csb/web dev
pnpm --filter @csb/api dev
pnpm --filter @csb/widget dev
pnpm --filter @csb/embed dev    # embed loader on http://localhost:3002
```

### 5.2 Seed LTD coupons (optional)

`pnpm db:seed:coupons` creates eight lifetime-deal coupons covering every
business-rule state, so redemption can be tested by hand without editing the
database. Run `pnpm db:migrate` first — the coupon indexes (and the
`Subscription.paddleSubscriptionId` rebuild to `unique + sparse`) come from it.

| Code | Grants | What it exercises |
|------|--------|-------------------|
| `SEED-HAPPY-BIZ` | business | succeeds |
| `SEED-HAPPY-PRO` | pro | succeeds on an unpaid org; refused on business/enterprise (no downgrade) |
| `SEED-HAPPY-ENT` | enterprise | upgrades an org already on business |
| `SEED-INACTIVE` | business | "This coupon is no longer active" |
| `SEED-FUTURE` | business | "This coupon is not yet valid" |
| `SEED-EXPIRED` | business | "This coupon has expired" |
| `SEED-SOLDOUT` | business | "This coupon has reached its maximum number of uses" |
| `SEED-LASTSLOT` | enterprise | one slot only — race two redemptions, exactly one wins |

Redeem at **/app/billing** as an **owner or admin**. Agents and viewers get 403:
a coupon changes what the workspace pays for, so it sits behind the same guard as
every other billing route. Manage codes at **LTD Coupons** in the admin app
(port 3003, under Revenue).

Re-running restores every coupon to its intended state and clears the seeded
codes' redemption history, so a manual pass can be repeated. See
[`__specs/36-ltd-coupons.md`](__specs/36-ltd-coupons.md) for the design.

## 6.1 Visitor console (fastest way to create a conversation)

[`test-visitor.html`](test-visitor.html) is a dependency-free page that talks to
the **same public widget endpoints the real widget uses** (`POST /widget/init` →
`POST /widget/conversations` → `POST /widget/conversations/:id/messages`), but
with a plain input box instead of an iframe. Serve it over HTTP alongside
[`test-widget.html`](test-widget.html) and open it.

Use it when you want to exercise the operator side without fighting the embed:

- Conversations it creates are **real** — they appear in the dashboard Inbox.
- It polls every 2s, so **AI answers and operator replies from the Inbox appear
  inline**, colour-coded (you / ai + confidence / operator).
- The conversation and session ids are printed at the top, so you can find the
  exact thread in the Inbox.
- **New visitor** starts a fresh session + conversation — each browser visitor is
  a separate thread, so a reply to one conversation never shows in another.
- **Save contact → Leads** fills in the `ContactSession`, so the visitor also
  shows up under Leads.

Agent ID and API base are editable fields at the top; they default to the
seeded agent. The API must allow the page's origin — `CORS_ORIGINS` has to
include e.g. `http://localhost:8080`.

## 7. Try the embed widget on a test page

The embed loader (`apps/embed`, port 3002) injects the chat widget into any host
page via a `<script>` tag. To try it locally, drop the snippet from the
**Developers** page (`/app/developers`) into an HTML file and serve that file over
**HTTP** — opening it as a `file://` page gives the widget a `null` origin and its
API calls fail CORS.

```html
<!-- test.html -->
<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Embed test</title></head>
  <body>
    <h1>Host page</h1>
    <script
      async
      src="http://localhost:3002/widget.js"
      data-agent="YOUR_AGENT_ID"
      data-widget-url="http://localhost:3001"
      data-api-url="http://localhost:4000"
    ></script>
  </body>
</html>
```

Serve the file from its folder on any free port outside 3000–4000:

```bash
cd /path/to/folder && python3 -m http.server 8080
# open http://localhost:8080/test.html
```

Requirements:

- `pnpm dev` running (or at least `@csb/embed` :3002, `@csb/widget` :3001, and
  `@csb/api` :4000), plus `pnpm dev:infra`.
- A **real `data-agent`** copied from `/app/developers`. The database ships empty,
  so register an account and create a website + agent first (see §5). The generated
  snippet emits `data-agent`, `data-widget-url`, and `data-api-url` only — the org
  and website are derived from the agent, and cosmetics (position/colour/theme) are
  fetched live from `GET /widget/appearance` so Studio changes apply without
  re-copying the snippet. `data-api-url` is what lets that live fetch reach the API
  from the host page (the public widget endpoints accept any origin via CORS).

## 8. Verify the install

```bash
pnpm verify:env       # required env vars present
pnpm verify:assets    # landing-page assets resolve
pnpm type-check       # TypeScript across all workspaces
pnpm lint
pnpm test
```

All five must be green before opening a PR (CI gates on the same set).

## 9. Production build (local)

```bash
pnpm build
```

Outputs land in each workspace's `dist/` (api, embed) or `.next/` (web, widget). To run the built artifacts locally:

```bash
pnpm --filter @csb/api start
pnpm --filter @csb/web start
pnpm --filter @csb/widget start
pnpm --filter @csb/admin start
pnpm --filter @csb/embed preview   # serves dist/widget.js on http://localhost:3002
```

> The embed app is a Vite library build — `dist/` contains only `widget.js`, so
> there is no page at `http://localhost:3002/`. Load the asset directly
> (`http://localhost:3002/widget.js`) or via a `<script>` tag on a host page.
> It uses `preview`, not `start`.

### 9.1 Full containerized stack (`docker-compose.full.yml`)

To verify the **built Docker images** end-to-end locally (the same images Coolify
runs) before deploying:

```bash
pnpm dev:full     # docker compose -f docker-compose.full.yml up --build
```

This builds + runs everything in containers: `mongo`, `redis`, `mailhog` + **api**
:4000, **web** :3000, **widget** :3001, **admin** :3003, **embed** :3002.

Prerequisites and gotchas:

- **Stop any `pnpm dev` / `pnpm dev:infra` first** — they hold the same ports
  (`pkill -f "turbo dev"`, and `pnpm dev:infra:stop`).
- The app containers use the **root `.env`** (`env_file: ['.env']`), not
  `apps/api/.env`. Point infra at the compose service names:
  `MONGODB_URI=mongodb://<appuser>:<pass>@mongo:27017/customer-support?authSource=customer-support`,
  Redis host `redis`, `SMTP_HOST=mailhog`. Also set `NEXTAUTH_URL=http://localhost:3000`
  and include the three localhost origins in `CORS_ORIGINS`.
- **Everything is read from `.env` — no hidden defaults.** The compose
  interpolates every `NEXT_PUBLIC_*` (and `API_INTERNAL_URL`) from `.env` using
  `${VAR:?…}`, so a missing required value **fails fast** with a clear error
  (e.g. `required variable NEXT_PUBLIC_API_URL is missing a value`) instead of
  silently building the wrong thing. `.env.example` ships working localhost
  values, so `cp .env.example .env` (then fill secrets) is enough.
- **The browser/server URL split is handled for you.** `NEXT_PUBLIC_*` are
  **build-time** (inlined into the browser bundle), so they're passed as
  `build.args` — set them to URLs the host browser can reach (`localhost:*`).
  `.env` is `.dockerignore`'d, so a runtime `environment:` value can't re-bake
  them; the build args are the source of truth. Server-side fetches inside the
  web/admin containers use the **runtime** `API_INTERNAL_URL`
  (`http://api:4000/api/v1`) over the compose network. (`API_INTERNAL_URL` falls
  back to the public URL in app code when unset, so `pnpm dev` and proxy-based
  deploys are unaffected — it's only *required by the compose*.)
- **Paddle checkout** is optional: set `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (your
  sandbox client-side token) in `.env` and rebuild web
  (`up --build web`) to enable the overlay; otherwise checkout shows
  "not configured". See [§13](#13-paddle-billing--sandbox-vs-production) for
  sandbox IDs, test cards, and webhook tunnel setup.
- After it's up, sync indexes once:
  `docker compose -f docker-compose.full.yml exec api pnpm db:migrate`.
- **Google sign-in 500 (`POST /auth/google → internal_error`) = the mongo app
  user is missing.** [`scripts/mongo-init.js`](scripts/mongo-init.js) creates the
  `csb` user **only on a fresh/empty mongo volume**. If the volume predates the
  script (or used different creds), the API can't authenticate to mongo and the
  first write (first-time Google sign-in creating User+Org+Membership) 500s.
  Fix: recreate the volume — `docker compose -f docker-compose.full.yml down -v`
  then `up`. Verify: `docker exec csb-mongo mongosh
  "mongodb://csb:csb-dev@localhost:27017/customer-support?authSource=customer-support"
  --quiet --eval 'db.runCommand({ping:1})'` should print `{ ok: 1 }`.

Open http://localhost:3000 (dashboard) · :3003 (admin) · MailHog :8025. Rebuild a
single app after a code change with
`docker compose -f docker-compose.full.yml up --build admin`.

> This is a single-host topology for local verification; it is **Docker-bridge**
> networking, distinct from Coolify's reverse-proxy networking (§10) — but it
> exercises the same Dockerfiles, build args, and standalone runtime, so a green
> `pnpm dev:full` is a strong pre-deploy signal.

## 10. Production deployment (Coolify)

[Coolify](https://coolify.io) is a self-hosted PaaS that builds from your Git
repo (Nixpacks or a Dockerfile) and runs the result behind a managed Traefik
reverse proxy with automatic Let's Encrypt TLS. This stack ships a Dockerfile
per app plus [`docker-compose.full.yml`](docker-compose.full.yml), so it maps
onto Coolify cleanly.

### 10.1 Services & ports

| Service | App | Dockerfile | Container port | Suggested domain |
|---------|-----|------------|----------------|------------------|
| API | `@csb/api` | [`apps/api/Dockerfile`](apps/api/Dockerfile) | `4000` | `api.example.com` |
| Web (dashboard + public) | `@csb/web` | [`apps/web/Dockerfile`](apps/web/Dockerfile) | `3000` | `app.example.com` |
| Admin portal | `@csb/admin` | [`apps/admin/Dockerfile`](apps/admin/Dockerfile) | `3003` | `admin.example.com` |
| Widget | `@csb/widget` | [`apps/widget/Dockerfile`](apps/widget/Dockerfile) | `3001` | `widget.example.com` |
| Embed (`widget.js`) | `@csb/embed` | [`apps/embed/Dockerfile`](apps/embed/Dockerfile) | `80` | `embed.example.com` |
| MongoDB | — | Coolify one-click (or Atlas) | `27017` | internal |
| Redis | — | Coolify one-click | `6379` | internal |

### 10.2 Prerequisites

- A server (VPS) with Coolify installed — see the [Coolify install docs](https://coolify.io/docs/installation).
- DNS records for each subdomain above pointing at the server's IP.
- The same external service credentials used locally (Google OAuth, OpenRouter,
  Pinecone, Firecrawl, Paddle, SMTP) — see [§3](#3-configure-environment-variables).

### 10.3 Choose a deployment style

**Option A — one Docker Compose resource (fastest).** In Coolify, create a new
resource → **Docker Compose**, point it at this repo, and use
`docker-compose.full.yml`. Coolify builds every service (api, web, admin,
widget, embed) and provisions Mongo + Redis from the `docker-compose.yml`
service definitions. Best for a single-server "everything together" deployment.

**Option B — one resource per app.** Create a
separate **Dockerfile** resource per app (api, web, admin, widget, embed) from
the same repo, each pointed at its `apps/<app>/Dockerfile`. This lets each app
scale, redeploy, and get its own domain independently. Add Coolify's one-click
**MongoDB** and **Redis** databases (or use MongoDB Atlas) and wire their
connection strings into the API's env.

### 10.4 Environment variables

Copy your production values into each resource's **Environment Variables** tab
(Coolify has a bulk "paste .env" import). Start from
[`.env.example`](.env.example) and set production values, in particular:

- `NODE_ENV=production`
- `MONGODB_URI`, `REDIS_*` — point at the Coolify-managed DBs (use the internal
  service hostnames, e.g. `mongodb://…@mongo:27017`) or Atlas.
- `JWT_SECRET`, `NEXTAUTH_SECRET` — fresh `openssl rand -base64 32` values.
- `API_BASE_URL=https://api.example.com`, `EMBED_BASE_URL=https://embed.example.com`.
- **NextAuth origins** — web and admin need **distinct** callback origins. With
  **Option A** (one compose), set `WEB_NEXTAUTH_URL=https://app.example.com` and
  `ADMIN_NEXTAUTH_URL=https://admin.example.com` (the compose maps each to that
  service's `NEXTAUTH_URL`). With **Option B** (one resource per app), set
  `NEXTAUTH_URL` per resource.
- `CORS_ORIGINS` — comma-separated list of every front-end origin
  (`https://app.example.com,https://admin.example.com,https://widget.example.com`,
  plus any customer site that embeds the widget).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — and add the production
  `https://app.example.com/api/auth/callback/google` redirect URI in Google
  Cloud Console.

> ⚠️ **`NEXT_PUBLIC_*` vars are baked in at build time.** The web, admin, and
> widget images read `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`,
> `NEXT_PUBLIC_WIDGET_URL`, `NEXT_PUBLIC_EMBED_URL`, `NEXT_PUBLIC_APP_URL`, and
> `NEXT_PUBLIC_PADDLE_*` during `next build`, so they must be set as **Build
> Variables** (not just runtime) before deploying, and a change to any of them
> requires a rebuild. Set these to the public HTTPS domains (e.g.
> `NEXT_PUBLIC_API_URL=https://api.example.com/api/v1`,
> `NEXT_PUBLIC_SOCKET_URL=https://api.example.com`). The Dockerfiles accept these
> as **build args** (`ARG NEXT_PUBLIC_*` → baked before `next build`); Coolify's
> Build Variables are passed through automatically.
>
> `API_INTERNAL_URL` is **optional** in Coolify: leave it unset and server-side
> fetches use the public URL (which resolves through the proxy). Set it only if
> you want web/admin server components to reach the API over a private/internal
> hostname instead.

### 10.5 Domains, TLS & WebSockets

- Assign each resource its domain in Coolify's **Domains** field; Coolify's
  Traefik proxy terminates TLS and issues Let's Encrypt certificates
  automatically.
- **Option A (one compose): bind each domain to its container port** with the
  `:port` suffix, since the services use `expose:` (not host-published `ports:`).
  In each "Domains for …" field append the port from [§10.1](#101-services--ports):
  api `…:4000`, web `…:3000`, widget `…:3001`, admin `…:3003`, embed `…:80`,
  mailhog `…:8025` (e.g. `http://app.example.com:3000`). You then browse the
  domain **without** a port — Traefik routes it to that container port.
- The API serves Socket.IO; Coolify's proxy forwards WebSocket upgrades by
  default, so `NEXT_PUBLIC_SOCKET_URL` can use the `https://` API domain.

### 10.6 First deploy & migrations

1. Deploy the **API** resource first (front-ends depend on it).
2. Run the index sync once against the production DB. Either open a terminal on
   the API container in Coolify and run `pnpm db:migrate`, or run it as a
   one-off command/pre-deploy hook:
   ```bash
   pnpm --filter @csb/api db:migrate
   ```
3. Deploy **web**, **admin**, **widget**, and **embed**.
4. The database starts empty — create the first account via the dashboard
   sign-up flow, then promote a user to platform admin (see
   [§0 “Accessing the admin portal”](#accessing-the-admin-portal)).

### 10.7 Health checks

Each app Dockerfile defines a `HEALTHCHECK` (API → `/api/health`, web →
`/api/health`, admin → `/login`), so Coolify shows per-container health and will
restart unhealthy containers (`restart: unless-stopped`). Verify a deploy with
`curl https://api.example.com/api/health`.

## 11. Common operations

| Task | Command |
|------|---------|
| Format code | `pnpm format` |
| Clean caches + `node_modules/.cache` | `pnpm clean` |
| Tail API logs (Docker) | `docker compose logs -f api` |
| Open Mongo shell | `docker exec -it csb-mongo mongosh -u admin -p password` |
| Reset everything (empty DB) | `pnpm dev:infra:reset && pnpm db:migrate` |
| Scrub website names off old agents | `pnpm --filter @csb/api agents:clean-names` (add `-- --apply` to write) |

## 12. Troubleshooting

- **`pnpm install` fails on lifecycle scripts** — run `pnpm approve-builds` to whitelist native deps, then retry.
- **API can't reach Mongo** — confirm `pnpm dev:infra` is up and `MONGODB_URI` in `.env` points to `localhost:27017` (or `mongo:27017` inside the full stack).
- **Web app shows blank dashboard** — check NextAuth: `NEXTAUTH_SECRET` set and `GOOGLE_CLIENT_ID/SECRET` valid.
- **`pnpm dev` rebuilds packages every time** — Turbo's cache may be stale; `pnpm clean && pnpm install`.
- **Widget loads but no AI replies** — verify `OPENROUTER_API_KEY` and `AI_MODEL`; check API logs for `429` (rate limit) or `401` (bad key).
- **Embed test page shows the error screen** — the `data-agent` is stale or missing. Copy a fresh snippet from `/app/developers` (the DB ships empty, so create an agent first), and serve the HTML over HTTP, not `file://` (see §7).
- **Phase-specific failures** — consult the matching plan in [`__plans/`](__plans/) and the procedure in [`__skills/`](__skills/).

## 13. Paddle Billing — Sandbox vs Production

### 13.1 Environment separation

The two `.env` files keep sandbox and production completely isolated:

| File | `PADDLE_ENVIRONMENT` | API key prefix | Client token prefix | Used by |
|------|----------------------|----------------|---------------------|---------|
| `.env` | `sandbox` | `pdl_sdbx_…` | `test_…` | `pnpm dev` (local) |
| `.env.prod` | `production` | `pdl_live_…` | `live_…` | Coolify (production) |

Running `pnpm dev` locally always hits the sandbox — no risk of touching live data.

### 13.2 Testing checkout locally (webhook tunnel)

Paddle's servers need to reach your local API to fire webhook events. Use ngrok:

```bash
# 1. Start the API locally
pnpm dev

# 2. In a separate terminal, expose port 4000
ngrok http 4000
# → https://<random>.ngrok-free.app
```

In the **Paddle sandbox dashboard** → Developer Tools → Notifications → add endpoint:

- URL: `https://<random>.ngrok-free.app/api/v1/billing/webhook`
- Events: `subscription.activated`, `transaction.completed`, `subscription.updated`, `subscription.canceled`

Copy the webhook secret Paddle shows and set it in `.env`:

```
PADDLE_WEBHOOK_SECRET=<secret from sandbox dashboard>
```

Restart the API. The checkout overlay will now fire real sandbox events end-to-end.

**Sandbox test cards:**

| Scenario | Card number | Expiry | CVV |
|----------|------------|--------|-----|
| Success | `4242 4242 4242 4242` | Any future | Any 3 digits |
| Decline | `4000 0000 0000 0002` | Any future | Any 3 digits |

### 13.4 Adding new plans or prices

1. Use `mcp__paddle__create_product` + `mcp__paddle__create_price` (or the Paddle dashboard) in both sandbox and production.
2. Update `.env` (sandbox IDs) and `.env.prod` (production IDs) — both server-side (`PADDLE_PRODUCT_*` / `PADDLE_PRICE_*`) and client-side (`NEXT_PUBLIC_PADDLE_PRODUCT_*` / `NEXT_PUBLIC_PADDLE_PRICE_*`).
3. Update `apps/api/src/config/plans.ts` with the new plan key and limits.

### 13.5 Operator integration webhooks (their OWN customers' subscriptions)

This is **separate** from platform billing above. When an operator connects **their
own** Paddle/Stripe (Integrations → Paddle/Stripe) so the widget AI can manage *their
customers'* subscriptions, they can register a per-connection callback so out-of-band
plan changes stay in sync:

- Callback URL (shown in Integrations → Paddle → **Configure plans** → "Subscription
  webhook"): `<API_BASE_URL>/api/v1/integrations/paddle/webhook/<connectionId>` (or
  `.../stripe/webhook/<connectionId>`).
- The operator pastes the provider's **signing secret** there; it's stored on the
  connection and verifies every incoming event's HMAC signature. **No env var** — the
  secret is per-connection, not the platform-wide `PADDLE_WEBHOOK_SECRET`.
- Verified `subscription.*` / `customer.subscription.*` events update an
  `ExternalSubscription` snapshot (see `services/integrations/webhookReceiver.ts`), so
  the assistant reflects changes the customer/operator made outside the chat and can
  still answer "what plan am I on?" during a provider API outage.
- **Plan price ids are per-environment.** Configure them for the environment the
  connection is actually serving (sandbox vs production). If upgrade/downgrade reports
  "no plans are configured for this environment", the plans were set on the other env's
  slot — re-enter them while the connection is on the target environment.

## 14. Error monitoring (Sentry)

Spec: [`__specs/35-error-monitoring-sentry.md`](__specs/35-error-monitoring-sentry.md).
Two projects under the `mllabs-xk` org — `chataxispro-backend` (`apps/api`) and
`chataxispro-frontend` (`apps/web`, browser + Next.js server). `apps/admin`,
`apps/widget` and `apps/embed` are not instrumented.

Everything is optional: with no DSN the SDKs never initialise, every Sentry call
is a no-op, and both apps behave exactly as before.

### 14.1 Configuration

| Where | Variables | When they're read |
|-------|-----------|-------------------|
| API service | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Runtime — restart to apply |
| Web **image build** | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Build — inlined into the client bundle |
| Web service | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Runtime — server-side errors only |
| Web build (optional) | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Build — source-map upload |

> **The one gotcha**: `NEXT_PUBLIC_SENTRY_DSN` must be set as a **build argument**,
> not just a runtime env var. In Coolify that means ticking "Build Variable" on
> the web service's variable. Set it only at runtime and the app looks healthy —
> server errors report, browser errors silently vanish.

Without `SENTRY_AUTH_TOKEN` the build still succeeds; production stack traces
just stay minified.

### 14.2 Verifying a deploy

Open `https://<web-host>/sentry-example-page` — public, `noindex`, no login. One
button per reporting path:

| Test | Proves |
|------|--------|
| Handled exception | Browser SDK reaches Sentry (reports the event ID in-page) |
| Uncaught exception | `window.onerror` path |
| Unhandled rejection | `unhandledrejection` path |
| React render crash | `global-error.tsx` reports render failures |
| Route handler 500 | Next.js server runtime + `onRequestError` |
| API unhandled 500 | Express handler (returns the event ID in the 500 body) |
| API handled message | API → Sentry connectivity, without causing a 500 |

Start with **Handled exception** and **API handled message**: both confirm
delivery in the page itself, so you learn whether the DSN works before hunting
through the Sentry issue feed. The two API endpoints are rate limited to 5/min
per IP.

The same endpoints work with curl:

```bash
curl -i https://<api-host>/api/v1/debug-sentry          # → 500 + error.eventId
curl -s https://<api-host>/api/v1/debug-sentry/message  # → {"configured":true,"eventId":"…"}
```

`"configured": false` means the API has no `SENTRY_DSN`.

### 14.3 Troubleshooting

- **Server events arrive, browser events don't** — `NEXT_PUBLIC_SENTRY_DSN` was
  not a build arg (see §14.1), or an ad blocker is active. Browser events are
  tunnelled through `/monitoring` on the app's own origin specifically to survive
  blockers; if that route 404s, the build predates the Sentry wiring.
- **Stack traces are minified** — no `SENTRY_AUTH_TOKEN` at build time.
- **A 404 or validation error didn't create an issue** — by design. The API only
  reports non-`ApiError` throws and `ApiError`s with status ≥ 500.
- **No events at all from the API** — check the boot log for
  `SENTRY_DSN not set — error monitoring is disabled`.

## 15. Where to go next

- Architecture & rationale: [`__specs/00-table-of-contents.md`](__specs/00-table-of-contents.md)
- Phased implementation plan: [`__plans/00-overview.md`](__plans/00-overview.md)
- Reusable procedures (skills): [`__skills/README.md`](__skills/README.md)
- Agent / contributor rules: [`AGENTS.md`](AGENTS.md)
