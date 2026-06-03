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
git clone <repo-url> customer-service-chatbot
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
pnpm db:migrate   # sync Mongoose indexes on all models
```

The database starts empty — there is no demo seed data. Create your first
account through the dashboard sign-up flow (or `POST /auth/register` on the API),
then add a website and agent from the UI. To start over from a clean database,
wipe the infra volumes and re-run the migration:

```bash
pnpm dev:infra:reset   # drop Docker volumes (including Mongo) and restart
pnpm db:migrate
```

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
  snippet also bakes in the saved Widget Studio cosmetics
  (`data-position` / `data-primary-color` / `data-theme`); only `data-agent` and
  `data-widget-url` are required — the org and website are derived from the agent.

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
pnpm --filter @csb/embed preview   # serves dist/widget.js on http://localhost:3002
```

> The embed app is a Vite library build — `dist/` contains only `widget.js`, so
> there is no page at `http://localhost:3002/`. Load the asset directly
> (`http://localhost:3002/widget.js`) or via a `<script>` tag on a host page.
> It uses `preview`, not `start`.

## 10. Common operations

| Task | Command |
|------|---------|
| Format code | `pnpm format` |
| Clean caches + `node_modules/.cache` | `pnpm clean` |
| Tail API logs (Docker) | `docker compose logs -f api` |
| Open Mongo shell | `docker exec -it csb-mongo mongosh -u admin -p password` |
| Reset everything (empty DB) | `pnpm dev:infra:reset && pnpm db:migrate` |

## 11. Troubleshooting

- **`pnpm install` fails on lifecycle scripts** — run `pnpm approve-builds` to whitelist native deps, then retry.
- **API can't reach Mongo** — confirm `pnpm dev:infra` is up and `MONGODB_URI` in `.env` points to `localhost:27017` (or `mongo:27017` inside the full stack).
- **Web app shows blank dashboard** — check NextAuth: `NEXTAUTH_SECRET` set and `GOOGLE_CLIENT_ID/SECRET` valid.
- **`pnpm dev` rebuilds packages every time** — Turbo's cache may be stale; `pnpm clean && pnpm install`.
- **Widget loads but no AI replies** — verify `OPENROUTER_API_KEY` and `AI_MODEL`; check API logs for `429` (rate limit) or `401` (bad key).
- **Embed test page shows the error screen** — the `data-agent` is stale or missing. Copy a fresh snippet from `/app/developers` (the DB ships empty, so create an agent first), and serve the HTML over HTTP, not `file://` (see §7).
- **Phase-specific failures** — consult the matching plan in [`__plans/`](__plans/) and the procedure in [`__skills/`](__skills/).

## 11. Where to go next

- Architecture & rationale: [`__specs/00-table-of-contents.md`](__specs/00-table-of-contents.md)
- Phased implementation plan: [`__plans/00-overview.md`](__plans/00-overview.md)
- Reusable procedures (skills): [`__skills/README.md`](__skills/README.md)
- Agent / contributor rules: [`AGENTS.md`](AGENTS.md)
