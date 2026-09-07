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
redeploy and get its own domain independently. Add Coolify's one-click
**MongoDB** and **Redis** databases (or use MongoDB Atlas) and wire their
connection strings into the API's env.

> ### ⚠️ The API runs at exactly ONE replica
>
> The web, admin, widget and embed apps are stateless and scale freely. **The
> API does not.** It keeps state in process memory that a second instance
> cannot see, and every failure mode is silent — no error, no alert, just a
> fraction of users getting wrong behaviour:
>
> | In-process state | What a second replica breaks |
> |---|---|
> | Socket.IO rooms (no Redis adapter) | A visitor connected to instance A never receives events emitted by instance B. Streaming replies, operator messages and typing indicators simply stop arriving for part of your traffic. |
> | OTP codes (`otpService.ts`) | A code issued by A cannot be verified by B, so identity-verified tool calls fail at random. |
> | Widget + integration rate limits | Each replica counts separately, so the effective limit multiplies by replica count. |
> | Background jobs (`setInterval`) | Firecrawl ingestion and embedding reconciliation run concurrently on every replica, duplicating work and cost. The `serialLoop` latch (§11.1b) only prevents a loop overlapping **itself inside one process**; it is not a distributed lock and does nothing across replicas. |
>
> Redis is already provisioned and `REDIS_URL` is read, but **nothing connects
> to it yet** — provisioning it does not make the API scalable. Lifting this
> limit means adding `@socket.io/redis-adapter`, moving the OTP and rate-limit
> stores to Redis, and giving the jobs a distributed lock or their own worker
> process.
>
> Until that work lands: keep the API resource at **1 instance** in Coolify and
> scale vertically (more CPU/RAM) rather than horizontally.

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

### 11.1 AI reply engine

The agent that answers customer messages is a LangGraph state graph
(`apps/api/src/services/ai/graph/`) — `agent → tools → finalize`, described in
[`__specs/05-ai-agent-design.md`](__specs/05-ai-agent-design.md).

It is the only implementation — there is no engine switch to set. **Roll back a bad AI deploy by
redeploying the previous API image**, the same as any other part of the API.

Two knobs bound a turn's cost: `AI_MAX_TOOL_TURNS` (default 10) caps agent↔tool round trips, and
`AI_LLM_TIMEOUT_MS` / `AI_LLM_MAX_RETRIES` bound each upstream call.

### 11.1b Background job loops

Four loops run on plain `setInterval` timers inside the API process: embedding
reconciliation (60s), Firecrawl polling (30s), the RAG quality alert sweep, and
index health. There is no external queue, so a single API process owns them.

Each is wrapped in `serialLoop` (`apps/api/src/jobs/serial-loop.ts`), which
**drops a tick whose predecessor is still running**. None of these jobs claim
their work atomically, so overlapping runs would select the same rows twice: the
reconcile pass picks up to 20 sources by `embeddingStatus` and that status only
changes when the ingest finishes, meaning a source slower than the 60s interval
would get embedded twice and billed twice. Skipping loses nothing because each
loop is a sweep, not a queue consumer.

Two log lines to know:

```bash
grep -E "tick skipped|tick overran its interval" <api logs>
```

| Line | Meaning | What to do |
| --- | --- | --- |
| `[jobs] tick skipped, previous run still in flight` | A tick fired while the last run was still going. `skipped` counts them for that loop, `runningForMs` says how long the current run has been going | One or two under a large import is normal. A `skipped` count that climbs steadily means the loop never keeps up |
| `[jobs] tick overran its interval` | A run took longer than the gap between ticks | Normal on a big ingest. Persistent overruns on `reconcile` usually mean sources are failing and being retried in a batch of 20 every minute. See §13.8 |

If a loop goes silent entirely, the process holding it was restarted or the
latch is stuck behind a run that never settles; restarting the API clears it.
Because these are in-process timers, **running more than one API replica runs
every loop more than once**; see the note in §10.3.

### 11.2 LangSmith tracing (optional)

Tracing records every graph node, LLM call and tool call for the agent — invaluable when a
tool-heavy conversation goes wrong. It is **off by default and must stay that way unless you
intend it**: traces contain customer message content, which leaves your infrastructure.

Enable it by setting **both**:

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_xxx
# optional
LANGSMITH_PROJECT=customer-service-chatbot
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
```

A missing or empty API key keeps tracing off regardless of the flag, and startup actively clears
the SDK's environment variables in that case. Each turn appears as one `customer_reply` run,
tagged `org:<id>` and `agent:<id>`, with the conversation id in metadata.

## 12. Troubleshooting

- **`pnpm install` fails on lifecycle scripts** — run `pnpm approve-builds` to whitelist native deps, then retry.
- **API can't reach Mongo** — confirm `pnpm dev:infra` is up and `MONGODB_URI` in `.env` points to `localhost:27017` (or `mongo:27017` inside the full stack).
- **Web app shows blank dashboard** — check NextAuth: `NEXTAUTH_SECRET` set and `GOOGLE_CLIENT_ID/SECRET` valid.
- **`pnpm dev` rebuilds packages every time** — Turbo's cache may be stale; `pnpm clean && pnpm install`.
- **Widget loads but no AI replies** — verify `OPENROUTER_API_KEY` and `AI_MODEL`; check API logs for `429` (rate limit) or `401` (bad key). With LangSmith enabled (§11.2), the failing turn's trace shows exactly which node stopped.
- **A `/responses` 404 from OpenRouter** — something is constructing `ChatOpenAI` instead of `ChatOpenAICompletions`. The umbrella class routes newer model ids (gpt-5, o-series) to OpenAI's Responses API, which OpenRouter does not implement. Build models through `createChatModel()` in `services/ai/llm/chat-model.ts`.
- **Agent stops mid-action without replying** — expected when a tool halts the turn to wait on the customer (an inline form or an OTP challenge). Look for a `form` or `otp` block on the last AI message.
- **Embed test page shows the error screen** — the `data-agent` is stale or missing. Copy a fresh snippet from `/app/developers` (the DB ships empty, so create an agent first), and serve the HTML over HTTP, not `file://` (see §7).
- **Widget or inbox stops receiving live events**: check the API log for `[socket] refused conversation join` or `[socket] refused message:send`. Conversation-scoped socket events are authorized per conversation, not per tenant (`socket/authorize.ts`): an operator may act on any conversation in their own org, a contact only on its own session's. A refusal is silent to the client by design, so the log is the only place it appears. A legitimate refusal usually means a stale `conversationId` in the client after a session reset; clear the widget's stored session and reconnect.
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

### 13.x Payment ledger — reconciling a stuck or missing payment

Every `transaction.*` and `adjustment.*` event Paddle sends is recorded in the
`payments` collection, one row per transaction, keyed on `providerTransactionId`.
Billing history and the dunning banner both read from it.

**Every delivery is coming back 401 `invalid_signature`.** Two causes, in order
of likelihood:

1. The secret is stale. Each Paddle notification destination gets its own
   signing secret, so adding or recreating a destination invalidates the old
   `PADDLE_WEBHOOK_SECRET`. Update `.env` **and restart the API** — `tsx watch`
   watches source files, not `.env`, so a running dev server keeps serving the
   old secret and the symptom looks identical to a wrong secret.
2. The raw body is not reaching the verifier. Signatures are computed over the
   exact bytes Paddle signed, taken from `req.rawBody` (stashed by the global
   `express.json({ verify })` in `index.ts`). If someone reintroduces a
   per-route `express.raw()`, body-parser will skip it, the HMAC will be
   computed over an empty string, and every delivery fails. The HTTP-level tests
   in `billing-payments.test.ts` cover this.

**A payment is missing from billing history.**

1. Confirm Paddle actually delivered it. Paddle dashboard → Notifications →
   find the event, check its delivery status and response code. A non-2xx means
   we rejected it; the API log line will say why (`invalid_signature` is the
   usual culprit after a secret rotation).
2. If Paddle shows a 2xx delivery but no row exists, the event was almost
   certainly de-duplicated. The idempotency guard is claimed **before** any
   handler runs, so an event whose handler threw is recorded as processed and
   Paddle's retry is swallowed. Search the log for the `event_id`.
3. Repair by re-running the backfill for that org. It is idempotent and bypasses
   the webhook guard entirely:

   ```bash
   pnpm --filter @csb/api billing:backfill-payments --org <organizationId> --dry-run
   pnpm --filter @csb/api billing:backfill-payments --org <organizationId>
   ```

   `--dry-run` prints how many transactions would be written without touching
   the database. Always run it first on production.

**A customer is stuck on the checkout pending page.** The page polls
`/billing/subscription` and `/billing/payments/latest`. If the payment row says
`failed`, the page shows the decline and stops polling. If there is no row at
all, the webhook never arrived: check step 1 above, then use the admin "Refresh
status" action, which calls `syncSubscriptionFromPaddle` and bypasses
idempotency.

**A subscription is stuck in `past_due` after the customer paid.** A failed
payment sets `past_due`; a later `completed` for the same org clears it. If the
recovery event was missed, the state persists. Re-run the backfill for the org
(above) — replaying the successful transaction clears `past_due` through the
same code path the webhook uses. Note that `past_due` does **not** revoke
access: `Organization.plan` is written only by subscription events, so the
customer keeps working while the card is retried.

**A refund or chargeback did not show up.** These are not `transaction.*`
events. Look for `adjustment.created` / `adjustment.updated` in Paddle's
notification log. An adjustment is applied only when its `status` is `approved`
— a `pending_approval` refund is deliberately ignored until Paddle approves it,
at which point an `adjustment.updated` follows.

**A customer says the invoice link is broken.** Invoice URLs are minted on
demand and expire an hour after they are issued, so a link copied out of the
page and used later is expected to fail. Re-opening it from billing history
mints a new one. A `400 no_invoice` means the payment never billed (a failed or
pending charge has no invoice); a `502` means Paddle itself did not return one.

**Reading amounts.** `amount`, `tax` and `discount` are stored in **minor units**
(cents), exactly as Paddle reports them. A row showing `amount: 6000` is $60.00.
Divide only at the display edge.

## 13.5 Running a RAG evaluation before and after a retrieval change

Spec: [`__specs/39-rag-evaluation.md`](__specs/39-rag-evaluation.md).

The harness scores retrieval and generation against a committed fixture
knowledge base, so a change to the RAG pipeline can be defended with a number.
It runs the real `searchKb` and `generateAiReply`, so it needs the same
environment the API needs: Mongo, Pinecone and an OpenRouter key.

**The workflow around a retrieval change is always the same three steps.**

```bash
# 1. Baseline, BEFORE touching anything. Keep the path it prints.
pnpm eval:rag

# 2. Make the change.

# 3. Re-run against that baseline. Non-zero exit means a metric regressed.
pnpm eval:rag --baseline packages/rag-eval/reports/<the-baseline>.json
```

Step 1 is the one people skip, and without it step 3 is impossible: there is
nothing to compare against, and "it feels better" is what the harness exists to
replace.

**Cheaper loops while iterating.**

```bash
pnpm eval:rag --no-judge            # retrieval metrics only, spends no judge tokens
pnpm eval:rag --tag multi-hop       # just the slice you are working on
pnpm eval:rag --limit 10            # the CI smoke subset
```

`--retrieval-only` is the right default while tuning retrieval: it skips the
answering model and the judge entirely, leaving the query rewrite and the
embeddings. Recall@K, Precision@K, MRR and nDCG are the metrics a chunking,
rewriting or ranking change actually moves, and none of them need an answer.

**Toggling query understanding for a before/after.** The harness reads the
`AI_QUERY_*` flags from the environment, so the comparison is two runs:

```bash
AI_QUERY_REWRITE_ENABLED=false pnpm eval:rag --retrieval-only --tag follow-up
AI_QUERY_REWRITE_ENABLED=true  pnpm eval:rag --retrieval-only --tag follow-up
```

The report prints `rewrite p50` / `rewrite p95` (the model call alone, not the
retrieval it triggers) and the fallback rate. A high fallback rate means the
feature is costing a call and buying nothing.

**Reading the result.** Check the errored count first; anything above zero means
the numbers describe a subset. Then faithfulness and the unsupported-claims
list, which names the exact sentences the context did not support. Then Recall@K
against Precision@K: high recall with low precision means the evidence is found
and buried, low recall means it is not found at all and no prompt change will
fix that.

**Costs may read `unknown`, and that is correct.** OpenRouter prices a call
asynchronously and the usage service records zero when it gives up waiting. The
harness distinguishes the two and excludes unresolved cases from the total
rather than counting them as $0.00 — a fake zero in a budget table is
indistinguishable from a free call. A large unresolved count means the cost
figure is a floor, not a total; re-run later and the same cases usually resolve.

**Common failures.**

| Symptom | Cause |
| --- | --- |
| `402 ... requires more credits` on most cases | The OpenRouter balance is exhausted. Retrieval metrics still compute; generation ones do not. Add credits and re-run |
| `Fixture ingest produced 0 chunks for <doc>` | A fixture document is empty or unparseable. The harness fails loudly rather than scoring every case against it as a miss |
| `Unknown fixture document slug "x"` | A case references a document that is not in `fixtures/kb/`. Fix the slug; a silent skip would turn a positive case into a negative one |
| Judge cost `unknown` with cache hits | Every judge verdict came from cache, so nothing new was billed. Expected on a re-run |

**Re-seeding the fixture KB.** Ingestion is skipped when a document's content
hash is unchanged. After editing `fixtures/kb/`, the next run re-ingests that
document automatically; `--reingest` forces all of them, which costs embedding
tokens and is only needed if the chunker or embedding model changed.

## 13.5b Reading live RAG quality (`ragturnmetrics`)

Spec: [`__specs/39-rag-evaluation.md`](__specs/39-rag-evaluation.md), "Online
telemetry".

The offline harness above scores a fixed golden set. Production writes one
`RagTurnMetric` per customer turn, so the same questions can be asked of live
traffic. It is **on by default** (`RAG_TELEMETRY_ENABLED=true`), costs one
fire-and-forget document write per turn, and happens after the reply has been
sent — it cannot slow or break a customer reply.

**Is an org's assistant healthy right now?**

```bash
mongosh "$MONGODB_URI" --quiet --eval '
  const since = new Date(Date.now() - 24*60*60*1000);
  db.ragturnmetrics.aggregate([
    { $match: { organizationId: ObjectId("<orgId>"), createdAt: { $gte: since } } },
    { $group: {
        _id: null,
        turns:       { $sum: 1 },
        noHitRate:   { $avg: { $cond: ["$flags.noHits", 1, 0] } },
        lowConfRate: { $avg: { $cond: ["$flags.lowConfidence", 1, 0] } },
        escRate:     { $avg: { $cond: ["$flags.escalated", 1, 0] } },
        confidence:  { $avg: "$retrieval.retrievalConfidence" },
        p50Ms:       { $avg: "$durationMs" },
        cost:        { $sum: "$generation.costUsd" }
    } }
  ]).toArray()'
```

**What is the knowledge base missing?** The no-hit turns carry the masked query
that found nothing:

```bash
mongosh "$MONGODB_URI" --quiet --eval '
  db.ragturnmetrics.find(
    { organizationId: ObjectId("<orgId>"), "flags.noHits": true },
    { originalQuery: 1, rewrittenQuery: 1, createdAt: 1 }
  ).sort({ createdAt: -1 }).limit(20).toArray()'
```

**Online faithfulness.** Averaged over sampled turns only. Note the `$ne: null`:
a drawn turn with a null score means the judge produced no verdict (no passages,
over budget, no factual claims, or an error — see `faithfulness.skippedReason`),
and averaging those in as zeros would be wrong.

```bash
mongosh "$MONGODB_URI" --quiet --eval '
  db.ragturnmetrics.aggregate([
    { $match: { "faithfulness.sampled": true, "faithfulness.score": { $ne: null } } },
    { $group: { _id: null, n: { $sum: 1 }, faithfulness: { $avg: "$faithfulness.score" } } }
  ]).toArray()'
```

### Things that look wrong and are not

| Symptom | Explanation |
| --- | --- |
| `generation.costUsd` is `null` on recent turns | OpenRouter resolves cost asynchronously and the backfill has not landed yet, or it gave up. Null means **unknown**, deliberately — a `0` there would be indistinguishable from a free call |
| `faithfulness.score` null on a sampled turn | Read `faithfulness.skippedReason`. A correct refusal genuinely has no claims to score |
| `retrievalConfidence` low while replies look fine | Expect this when the top passages score closely: the margin term is small by design. Compare against `retrieval.topScore` before concluding anything |
| `retrieval.minScore` is `0` | That search fell through the widen-on-empty retry. The field records the floor **actually applied**, not the configured one |
| `status: "fallback"` | The graph never produced a state and the runner's safe reply went out. Look for `[ai] reply generation failed` in the same window |

### Turning things down

```bash
RAG_FAITHFULNESS_SAMPLE_RATE=0   # stop judge spend, keep every other metric
RAG_ALERT_ENABLED=false          # stop the alert sweep, keep collecting
RAG_TELEMETRY_ENABLED=false      # stop collecting entirely
```

Sampling is skipped automatically for an org over its monthly AI budget, so an
org whose replies are paused is never billed for measuring them.

## 13.5c Improving answer quality from feedback

Spec: [`__specs/04-pinecone-firecrawl.md`](__specs/04-pinecone-firecrawl.md),
"Index health".

The loop: production telemetry says which passages are pulling their weight and
which questions keep going unanswered; you repair the index; the next window
tells you whether it worked. Everything below lives on **RAG Quality**
(`/app/analytics/rag`), and nothing on this page changes anything until you
press something.

### Start from the symptom, not the panel

| What you were told | Where to look | The repair |
| --- | --- | --- |
| "It keeps saying it doesn't know" | Gap clusters | Answer the top cluster |
| "It gave a customer the wrong policy" | Passages that need work → **Misleading** | Fix that document's content, then re-index it |
| "The answer is vague even though we document it" | Passages that need work → **Never quoted** | Almost always chunking: the sentence that answers the question got split away from its heading. Rewrite the passage so it stands alone, then re-index |
| "We have hundreds of docs and it uses three" | Knowledge health → Never retrieved | Review, then delete or rewrite |

### The four repairs

**Re-index one source.** Tears that source's vectors down first, then re-ingests.
Use it after editing a document, or when a passage looks right but retrieves
wrong. It touches nothing else — the vector ids are prefixed with the source id
and `index-health.test.ts` asserts the isolation by recording every vector
operation.

**Answer a gap.** Writes a `Q: … / A: …` pair as its own source at priority 5 and
closes every gap in the cluster. The question is stored with the answer on
purpose: the customer's phrasing is exactly the phrasing that failed to match
anything, so embedding it is the point. Needs a single website selected, since a
Q&A pair belongs to one agent's knowledge base.

**Mark stale / lower authority.** Metadata only — no re-embed, and
`sourceUpdatedAt` does not move. Reach for this instead of deleting when
something newer should win but the old document is still the only thing you
have. A stale source stays retrievable: hiding it turns "this is out of date"
into "we have no answer".

**Bulk delete dead weight.** Two steps, and the second cannot be reached without
the first. Review shows the exact list and issues a token over it; the confirm is
refused if the list differs, if 15 minutes have passed, or if any of those
sources started being retrieved in the meantime.

### Reading the flags without over-reacting

- Every rate is held behind `KB_HEALTH_MIN_RETRIEVALS` (5). A passage retrieved
  twice and downvoted once is two retrievals, not a 50 percent failure.
- A blank downvote rate means **nobody rated it**, which is not approval.
- `Never quoted` only fires on passages that also scored well. A passage that
  scraped into the prompt on a thin query and was ignored is the system working.
- **The scan reads at most 20,000 passages.** Dead weight is defined by the
  absence of telemetry, so the scan has to list every chunk and therefore needs a
  ceiling (`CHUNK_SCAN_LIMIT` in `index-health.service.ts`). Past it the panel
  says so ("Counts cover the first 20,000 passages of a larger knowledge base"),
  the `kb_weak_chunks` notification carries the same note, and the API logs
  `[index-health] chunk scan truncated`. Treat the counts as a sample of the
  index, not a census, whenever you see that line. Repairs are unaffected: they
  act on the passages actually listed.

### Turning on the scheduled half

```bash
KB_INDEX_HEALTH_ENABLED=true      # default false
KB_INDEX_HEALTH_HOUR_UTC=3        # when it may re-embed
KB_INDEX_HEALTH_MAX_REEMBED_PER_RUN=10
```

It does two things and no more: re-embeds sources whose stored text no longer
matches the hash their vectors were built from, and raises one
`kb_weak_chunks` notification per org per day. **It never deletes and never
edits content.** Leave it off until you have watched the flags against your own
traffic for a window — that is what the default is for.

Verify a night's run:

```bash
grep -E "index health tick|re-embedded drifted source" <api logs>
```

`reembedded: 0` on a healthy corpus is the expected result, not a failure: the
job selects on hash mismatch, so a corpus that has not drifted costs one indexed
find.

### Things that look wrong and are not

| Symptom | Explanation |
| --- | --- |
| A passage is both "Misleading" and "Never quoted" | Two different problems in one passage. Collapsing them to one label would hide half the story |
| Gap clusters shrink after you answer one | Answering closes every gap in the cluster, so it leaves the open list entirely |
| "Never retrieved" lists a source you know is good | It is unreachable by the questions being asked, not necessarily bad. Check the gap clusters for what people ask instead, and rewrite rather than delete |
| Bulk delete refuses right after a review | Something in the list started being retrieved. Re-run the review — that is the check doing its job |
| A source stays in "Never retrieved" after re-indexing | Re-indexing rebuilds vectors from the same text. If nobody asks about that text, it stays unretrieved. Rewrite it in the customer's vocabulary instead |

## 13.6 Backfilling the chunk mirror, and changing the embedding model

Spec: [`__specs/41-hybrid-retrieval.md`](__specs/41-hybrid-retrieval.md).

Retrieval reads passage text from the `kbchunks` mirror and runs a lexical leg
against it. A deployment whose mirror has not been backfilled falls back to the
truncated Pinecone metadata, so nothing breaks — but the lexical leg finds
nothing and retrieval is dense-only.

**Backfill.** Always dry-run first; it prices the whole run before writing a
single vector.

```bash
cd apps/api
pnpm tsx scripts/reembed.ts --all --dry-run   # cost + per-source delta, no writes
pnpm tsx scripts/reembed.ts --all             # backfill
pnpm tsx scripts/reembed.ts --all --resume    # continue an interrupted run
pnpm tsx scripts/reembed.ts --org <id>        # one organization
```

`--resume` skips any source already fully mirrored, so an interrupted run is
restarted with the same command. There is no checkpoint file to go stale.

**Changing the embedding model is not a config change.** It is a config change
**plus a mandatory full reindex**, and doing only the first half silently breaks
retrieval with no error anywhere:

> An index holding vectors from two different embedding models returns nonsense.
> Cosine distance between two embedding spaces means nothing. If you change
> `EMBEDDING_MODEL` and restart without reindexing, queries are embedded with the
> new model and compared against documents embedded with the old one. Retrieval
> degrades to noise, silently.

The safe order is: take the KB out of service or accept degraded retrieval for
the duration, set `EMBEDDING_MODEL` (and `EMBEDDING_DIMENSIONS` if the new model
is larger than the index), then run `--all` to completion. `--resume` makes an
interrupted switch recoverable, but the window between the config change and the
end of the reindex is a window of bad answers.

`EMBEDDING_DIMENSIONS` is required for any model whose native size exceeds the
index dimension. The index here is 1536; `text-embedding-3-large` is 3072
natively and cannot be upserted at all without `EMBEDDING_DIMENSIONS=1536`.

**Tuning the dense/lexical blend.** `KB_HYBRID_ALPHA` is 1.0 dense-only, 0.0
lexical-only, default 0.7 from a measured sweep. To re-derive it on your own
corpus:

```bash
for A in 1.0 0.7 0.5 0.3 0.0; do
  KB_HYBRID_ALPHA=$A pnpm eval:rag --retrieval-only
done
```

Expect an inverted U. If a extreme wins outright, one leg is not contributing and
that is worth understanding before shipping the extreme as a default.

**Common failures.**

| Symptom | Cause |
| --- | --- |
| Lexical leg returns nothing for everything | The mirror is not backfilled, or the text index was not built. `db.kbchunks.getIndexes()` should show `kb_chunk_text` |
| Retrieval quality collapsed after an env change | `EMBEDDING_MODEL` changed without a reindex. See above |
| `[kb] lexical leg failed, degrading to dense-only` | Expected under load or a slow query; retrieval still works. Persistent occurrences mean the text index is missing or `KB_LEXICAL_TIMEOUT_MS` is too tight |
| Upsert fails on dimension mismatch | The model emits more dimensions than the index accepts. Set `EMBEDDING_DIMENSIONS` |

## 13.7 Turning on cross-encoder reranking

Spec: [`__specs/42-reranking.md`](__specs/42-reranking.md).

Reranking is off by default and is a **trade, not a free upgrade**: it makes
unanswerable questions detectable (every negative case in the eval set correctly
returns "no evidence" instead of retrieving noise) and costs roughly 8 points of
Recall@5 on answerable ones, plus ~1.2s and one external dependency per KB
search.

```bash
KB_RERANK_ENABLED=true
KB_RERANK_PROVIDER=pinecone      # needs PINECONE_API_KEY, already set for the index
```

**Re-sweep the floor on your own corpus.** `KB_RERANK_MIN_SCORE` is the setting
most likely to be wrong for you, because the useful signal is the *gap* between
the answering passage and the rest, not the magnitude — and the magnitude varies
by corpus. A floor tuned by intuition rejects evidence for every query phrased
less directly than the documents.

```bash
for MS in 0.02 0.005 0.001 0.0005; do
  KB_RERANK_ENABLED=true KB_RERANK_MIN_SCORE=$MS pnpm eval:rag --retrieval-only
done
```

Watch the **widen-on-empty rate** in the report: that is the share of queries
returning no evidence. Compare it against the share of your dataset that is
genuinely unanswerable. If it is much higher, the floor is rejecting real
evidence and every one of those turns escalates unnecessarily.

**What the two failure modes look like in production:**

| Symptom | Cause |
| --- | --- |
| Escalation rate jumped after enabling | `KB_RERANK_MIN_SCORE` is too high. Every query whose best passage scores below it is told there is no evidence |
| Multi-hop answers became half-answers | Should not happen — the floor gates on the best candidate, not each one. If it recurs, check that `rerankHits` still slices `ordered` rather than a filtered list |
| `[kb] rerank failed, keeping stage-1 order` | Expected occasionally; retrieval still works at stage-1 quality. Persistent means the provider is down or `KB_RERANK_TIMEOUT_MS` is too tight for `KB_RERANK_CANDIDATES` |
| Latency up ~1.2s per turn | Expected at 50 candidates. Lower `KB_RERANK_CANDIDATES` to trade recall for speed |

**`widenOnEmpty` is disabled automatically while reranking is on.** That hedge
existed because an uncalibrated cosine floor could not tell an irrelevant passage
from a relevant one scoring low. With a calibrated score downstream it would only
feed stage 2 noise, so it is gated off rather than left to interact.

## 13.8 Knowledge ingestion is failing

Spec: [`__specs/04-pinecone-firecrawl.md`](__specs/04-pinecone-firecrawl.md).

**Start at the source detail page.** Every failure now carries a classified
message and a suggested action, and the Indexing history panel shows the stage
timeline grouped by attempt. That answers most triage without touching a shell:
you can see which stage failed, how long it took, how many times it has been
retried, and whether retrying will help at all.

### Decide first whether retrying can possibly work

| The message says | Class | Retrying |
| --- | --- | --- |
| "This file type can't be read" | `unsupported_file_type` | **Never helps.** Convert the file |
| "The file couldn't be opened…" | `parse_failure` | **Never helps.** Fix or re-export the file |
| "Read successfully but contains no selectable text" | `empty_extraction` | **Never helps.** OCR it, or paste the text in |
| "The embedding provider returned an error" | `embedding_provider_error` | Automatic, with backoff |
| "…is rate limiting us" | `rate_limited` | Automatic, with backoff |
| "reached its monthly AI budget" | `budget_exceeded` | Waits for the budget. **No retries are consumed** |
| "The search index rejected the write" | `pinecone_upsert_failure` | Automatic |
| "stopped partway through" | `partial_upsert` | Automatic; the next run re-indexes the whole source |
| "took too long" | `timeout` | Automatic. Split very large files |

The three permanent classes consume **zero** retries by design. If you see one,
the fix is to the file, not to the system.

### Status meanings that are easy to misread

- **`empty`** — the file was read fine and produced nothing searchable. This is a
  failure. It used to report as `synced`, which is why these were invisible.
- **`processing` on a website source** — usually a crawl in flight, not a hang.
  The crawl id is parked in `embeddingError` as `firecrawl:<id>`, and the
  reconcile job deliberately leaves these alone.
- **`processing` on anything else, for over 15 minutes** — an interrupted ingest,
  almost always a deploy mid-run. The reconcile job re-queues it and records a
  `recover` event.

### Org-wide checks

```bash
# Health summary: status counts, failure rate, breakdown by error class,
# mean duration by source type, and what is in recovery right now.
GET /api/v1/knowledge/health/ingestion

# The stage timeline for one source, grouped by attempt.
GET /api/v1/knowledge/:id/events
```

An alert fires when a workspace's failure rate crosses
`KB_INGEST_FAILURE_ALERT_RATE` (default 30%) with at least
`KB_INGEST_FAILURE_ALERT_MIN_SOURCES` sources — the floor stops a new workspace
alerting on its first bad upload. The alert latches per source so an unresolved
failure does not re-notify every 60 seconds.

### Retry from the UI

The Re-ingest button is a deliberate operator decision, so it **clears the
automatic retry budget and the alert latch**. Without that, a source that had
exhausted its three attempts could be retried once by hand and then never again
by the reconcile job, and would never re-alert.

### Correlating logs

Every ingest run logs a `runId`, and every event row carries it. To follow one
attempt end to end:

```bash
grep '"runId":"<id>"' <log>
```

### If nothing is being retried at all

Check that the jobs are running: `[jobs] scheduling background jobs` appears once
at boot. They are plain `setInterval` timers in `jobs/index.ts` with no external
queue, so if the API process is not running, nothing reconciles.

## 14. Error monitoring (Sentry)

Spec: [`__specs/35-error-monitoring-sentry.md`](__specs/35-error-monitoring-sentry.md).
Two projects under the `mllabs-xk` org — `addisaipro-backend` (`apps/api`) and
`addisaipro-frontend` (`apps/web`, browser + Next.js server). `apps/admin`,
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
