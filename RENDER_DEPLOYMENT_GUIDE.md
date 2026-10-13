# Deploying ResolveAI on Render

This guide walks through deploying all five apps (API, web, admin, widget, embed) on [Render](https://render.com), from an empty Render account to a working install. Every app already has a Dockerfile, so each one becomes a Render **Docker web service** built from this repo. If you'd rather pick **Node** as the language in Render's form, use [Option B: Node runtime](#option-b-node-runtime-no-docker) in step 5 for the field values.

Each app is its own Render service. A single service can't run all of them: Render routes traffic to one port per service, and the apps expect their own domains.

If you're deploying on Coolify instead, see [RUNBOOK.md §10](RUNBOOK.md#10-production-deployment-coolify).

---

## What you'll end up with

| Render service | App | Dockerfile | `PORT` | Health check path | Suggested domain |
|---|---|---|---|---|---|
| `resolve-ai-api` | `@csb/api` | `apps/api/Dockerfile` | `4000` | `/health` | `api.example.com` |
| `resolve-ai-web` | `@csb/web` | `apps/web/Dockerfile` | `3000` | `/api/health` | `app.example.com` |
| `resolve-ai-admin` | `@csb/admin` | `apps/admin/Dockerfile` | `3003` | `/login` | `admin.example.com` |
| `resolve-ai-widget` | `@csb/widget` | `apps/widget/Dockerfile` | `3001` | `/api/health` | `widget.example.com` |
| `resolve-ai-embed` | `@csb/embed` | `apps/embed/Dockerfile` | `80` | `/widget.js` | `embed.example.com` |

Outside Render:

- **MongoDB:** MongoDB Atlas. Render has no managed MongoDB.
- **File uploads:** an S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2). A Render Disk also works, with trade-offs covered in [step 2](#step-2-pick-where-uploads-are-stored).
- **Redis: not needed.** The API reads `REDIS_URL` but nothing connects to it yet, so skip Render Key Value for now.
- **Everything else** stays as it is locally: OpenRouter, Pinecone, Firecrawl, Paddle, Google OAuth, an SMTP provider, and optionally Sentry and LangSmith.

---

## Before you start: two rules for this stack

**1. The API must run as exactly one instance.** Socket.io rooms, OTP codes, rate-limit counters and the background job loops all live in the API process's memory. Run a second instance and some users stop getting live messages, OTP checks fail at random, and jobs like Firecrawl ingestion run twice and double your embedding bill. None of this shows up as an error. Keep the API at **1 instance, with autoscaling off**, and give it a bigger instance type when it needs more capacity. [RUNBOOK §10.3](RUNBOOK.md#103-choose-a-deployment-style) has the full explanation. The four frontends are stateless and can scale freely.

**2. Don't put the API on the Free plan.** Free services spin down after 15 minutes without traffic. That drops every socket connection and stops the background jobs (embedding reconcile, Firecrawl polling, OAuth token refresh, RAG alerts, index health), and the first request after that waits about a minute for the service to wake up. Free services also can't attach disks or open a shell. The frontends can sit on Free while you test, but each one will have the same cold start.

---

## Step 1: Set up MongoDB Atlas

1. Create a cluster at [cloud.mongodb.com](https://cloud.mongodb.com). Put it in the same cloud region as your Render services (for example AWS `us-west-2` for Render's Oregon region, or `eu-central-1` for Frankfurt).
2. **Database Access:** create a database user with a strong password.
3. **Network Access:** allow Render to connect. The tighter option is to add your Render region's outbound IPs, which you'll find on any Render service under **Connect → Outbound**. The quick option is `0.0.0.0/0`, which leaves the password as your only protection.
4. **Connect → Drivers:** copy the connection string and add the database name `customer-support`:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/customer-support?retryWrites=true&w=majority
   ```
   This is your `MONGODB_URI`.

You don't need to run anything against the database yet. The API runs migrations automatically every time it starts (see [step 6](#step-6-deploy-the-api)).

---

## Step 2: Pick where uploads are stored

Attachments and KB file uploads go through a storage adapter ([apps/api/src/config/storage.ts](apps/api/src/config/storage.ts)). By default the API writes to local disk, and **Render's filesystem is wiped on every deploy and restart**, so you need one of the two options below.

### Option A: S3-compatible bucket (recommended)

The MinIO adapter speaks the S3 protocol, so it works with R2, S3 and B2. It switches on automatically when `MINIO_ENDPOINT` and `MINIO_ACCESS_KEY` are both set.

1. Create a private bucket, for example `resolve-ai-attachments`. Create it yourself; don't count on the API to do it. The adapter will try to create a missing bucket, but most scoped API tokens aren't allowed to.
2. Create an access key that can read and write that bucket.
3. Write down these values for step 6:

| Variable | Cloudflare R2 | AWS S3 |
|---|---|---|
| `MINIO_ENDPOINT` | `<account-id>.r2.cloudflarestorage.com` | `s3.<region>.amazonaws.com` |
| `MINIO_PORT` | `443` | `443` |
| `MINIO_USE_SSL` | `true` | `true` |
| `MINIO_ACCESS_KEY` | R2 access key ID | IAM access key ID |
| `MINIO_SECRET_KEY` | R2 secret access key | IAM secret access key |
| `MINIO_BUCKET` | your bucket name | your bucket name |

Put the hostname alone in `MINIO_ENDPOINT`, with no `https://` in front.

### Option B: Render Disk

Attach a persistent disk to the API service, mounted at `/app/uploads` (the path the Dockerfile already prepares). Before choosing this, know that:

- A service with a disk can't scale past one instance. The API is already limited to one, so that part costs nothing.
- **Disks turn off zero-downtime deploys.** Render stops the old instance before it starts the new one, so the API is unreachable for a short while on every deploy.
- The disk is only visible to the running service, not to builds, pre-deploy commands or one-off jobs.
- The Docker image runs as the non-root `app` user. If the API logs `EACCES` when saving an upload, the disk mount isn't writable by that user. Switch to Option A in that case.

---

## Step 3: Decide on your domains

Every frontend bakes the API URL into its JavaScript at build time, and the API needs every frontend's origin for CORS. So you have to know all five URLs **before** the first build.

- **Custom domains (recommended):** pick them now, for example `api.`, `app.`, `admin.`, `widget.` and `embed.example.com`. You'll add the DNS records in [step 9](#step-9-add-custom-domains). The rest of this guide uses these example names.
- **`onrender.com` URLs:** each service gets `https://<service-name>.onrender.com`. Use the names from the table above, and check each URL Render actually assigns after you create the service. Render adds a suffix if the name is already taken. If any URL differs from what you planned, fix the env vars that reference it and redeploy.

Pick one Render region (Oregon, Ohio, Virginia, Frankfurt or Singapore) and create **every** service in it.

---

## Step 4: Generate secrets

Run this locally and keep the output somewhere safe:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # NEXTAUTH_SECRET (shared by web and admin)
openssl rand -hex 32      # CREDENTIALS_ENCRYPTION_KEY (must be 64 hex chars)
```

Treat `CREDENTIALS_ENCRYPTION_KEY` as permanent. It encrypts stored integration credentials, and changing it later makes them unreadable.

---

## Step 5: Connect the repo to Render

1. Sign in at [dashboard.render.com](https://dashboard.render.com) and connect your GitHub account.
2. Give Render access to the `resolve-ai` repository.
3. Optional: create an **Environment Group** called `resolve-ai-shared` for the values more than one service needs (`NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_APP_NAME`). Link it to each service as you create it. Then a change happens in one place instead of four.

Pick one runtime for every service: **Option A (Docker)** or **Option B (Node)**. Steps 6 and 7 are written for Docker. With Node, the env vars, health checks and instance advice in those steps still apply, but take the commands from the Option B table.

### Option A: Docker (recommended)

**Settings that are the same for every service you create below:**

| Field | Value |
|---|---|
| Source | the `resolve-ai` repo, branch `main` |
| Language / Runtime | **Docker** |
| Root Directory | *(leave empty: the repo root)* |
| Docker Build Context Directory | `.` (the repo root) |
| Dockerfile Path | `apps/<app>/Dockerfile` |

The build context has to be the repo root. Every Dockerfile copies `pnpm-lock.yaml`, `pnpm-workspace.yaml` and the shared `packages/` from there.

**How env vars reach the build:** Render passes every environment variable on a Docker service into the build as a build arg, and also sets it at runtime. The Dockerfiles declare `ARG NEXT_PUBLIC_*` and `ARG VITE_*`, so setting those as ordinary env vars on the service is enough. If you change one later, choose **Save, rebuild, and deploy**. A restart alone keeps the old value in the bundle.

### Option B: Node runtime (no Docker)

Render builds and runs each app straight from the repo, with no image. Use this if you choose **Language: Node** in the **New → Web Service** form. These are the values for each field, top to bottom:

| Form field | Value |
|---|---|
| Name | the service name from [the table at the top](#what-youll-end-up-with), for example `resolve-ai-api` |
| Project | optional. Pick your project and environment (for example `ResolveAI` / `Production`) |
| Language | **Node** |
| Branch | `main` |
| Region | the same region for every service (step 3) |
| Root Directory | **leave empty.** The build needs the whole workspace: `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `packages/`. Use Build Filters (see [Ongoing operations](#ongoing-operations)) to limit which pushes redeploy the service |
| Build Command | per service, from the table below |
| Start Command | per service, from the table below |
| Instance Type | see the per-service notes in steps 6 and 7. The API must not be on Free |
| Environment Variables | the service's list from step 6 or 7, **plus** the extra Node vars below |
| Advanced → Health Check Path | the path from the table at the top |

**Build and start commands:**

| Service | Build Command | Start Command |
|---|---|---|
| `resolve-ai-api` | `pnpm install --frozen-lockfile --prod=false && pnpm --filter @csb/api build` | `cd apps/api && node dist/scripts/migrate.js && node dist/index.js` |
| `resolve-ai-web` | `pnpm install --frozen-lockfile --prod=false && pnpm --filter @csb/web build` | `pnpm --filter @csb/web start` |
| `resolve-ai-admin` | `pnpm install --frozen-lockfile --prod=false && pnpm --filter @csb/admin build` | `pnpm --filter @csb/admin start` |
| `resolve-ai-widget` | `pnpm install --frozen-lockfile --prod=false && pnpm --filter @csb/widget build` | `pnpm --filter @csb/widget start` |
| `resolve-ai-embed` | create it as a **Static Site**, not a web service. See [step 7.4](#74-embed-resolve-ai-embed) | (none) |

Why the commands look like this:

- **Build one app, not `pnpm build`.** The root `pnpm build` runs `turbo build`, which builds all five apps on every deploy of every service. That's slow, and it builds four apps the service never serves. There is also no root `pnpm start`.
- **`&&`, not `;`.** With `;`, a failed install still moves on to the build, and the error you see is a confusing one further down.
- **`--prod=false`.** If `NODE_ENV=production` is set on the service (the API needs it), pnpm skips devDependencies. Those include `typescript` for the API and `tailwindcss` for the Next apps, so the build fails with `tsc: not found` or a missing-module error. This flag installs them anyway.
- **The API start command runs migrations first**, the same as the Docker entrypoint does. If a migration fails, `&&` stops the server from starting and the deploy fails. To skip migrations for one deploy, change the start command to `cd apps/api && node dist/index.js`, then change it back. `SKIP_DB_MIGRATE` only works with Docker.
- **The Next apps' start scripts set their own port** (web 3000, widget 3001, admin 3003). Set `PORT` on each service to the same value, as steps 6 and 7 already list.

**Extra env vars for Node services:**

| Variable | Set on | Value | Why |
|---|---|---|---|
| `NODE_VERSION` | every service | `20` | Matches the Docker images (`node:20-alpine`). `package.json` says `>=20.0.0` with no upper bound, so without this Render picks its newest Node, which the Docker builds have never been tested on |
| `NEXT_OUTPUT_FILE_TRACING_ROOT` | web, admin, widget | `/opt/render/project/src` | Render checks the repo out at that path. Pinning it keeps the standalone output at `.next/standalone/apps/<app>/`, where the `postbuild` copy and `start` script expect it |
| `STORAGE_LOCAL_PATH` | API, only with a Render Disk | your disk's mount path plus `/uploads`, for example `/var/data/uploads` | The Docker path `/app/uploads` doesn't exist outside the image. Mount the disk at `/var/data`. Skip this if you use a bucket (step 2, Option A) |

Render runs pnpm from its own toolchain. The root `package.json` declares `packageManager: pnpm@9.15.0`, and a newer pnpm switches to that version on its own, so the lockfile is read by the same pnpm you use locally.

Env vars are available during the build on the Node runtime too, so `NEXT_PUBLIC_*` values still get baked into the bundle. As with Docker, changing one later needs **Save, rebuild, and deploy**.

---

## Step 6: Deploy the API

Create it first, since the frontends depend on it.

1. **New → Web Service**, pick the repo, then:
   - Name: `resolve-ai-api`
   - Region: your chosen region
   - Dockerfile Path: `apps/api/Dockerfile`
   - Instance Type: **Starter at minimum**. Standard (2 GB) is safer, because PDF parsing, `sharp` image processing and LangGraph agent runs all use memory.
2. **Advanced → Health Check Path:** `/health`
3. **Environment variables.** Start from [.env.example](.env.example) and [__specs/13-env-variables.md](__specs/13-env-variables.md) for the full list. These are the ones that differ from local dev or are required at startup:

   ```bash
   NODE_ENV=production
   PORT=4000
   TRUST_PROXY=1
   API_BASE_URL=https://api.example.com
   CORS_ORIGINS=https://app.example.com,https://admin.example.com,https://widget.example.com
   WEB_INTERNAL_URL=https://app.example.com
   EMBED_BASE_URL=https://embed.example.com

   MONGODB_URI=<from step 1>
   JWT_SECRET=<from step 4>
   CREDENTIALS_ENCRYPTION_KEY=<from step 4>

   # AI (all required at startup)
   OPENROUTER_API_KEY=...
   OPENROUTER_BASE_URL=...
   AI_MODEL=...
   AI_TEMPERATURE=0.2
   AI_ENHANCE_TEMPERATURE=0.3
   AI_SUGGESTIONS_TEMPERATURE=0.4
   AI_CONFIDENCE_THRESHOLD=0.7
   AI_KB_SEARCH_TOP_K=8
   AI_KB_SEARCH_MIN_SCORE=0.2
   EMBEDDING_API_KEY=...
   EMBEDDING_BASE_URL=...
   EMBEDDING_MODEL=text-embedding-3-small

   PINECONE_API_KEY=...
   PINECONE_INDEX=...
   FIRECRAWL_API_KEY=...
   FIRECRAWL_BASE_URL=...

   # Storage, Option A from step 2 (leave all MINIO_* unset if you use a Render Disk)
   MINIO_ENDPOINT=...
   MINIO_PORT=443
   MINIO_USE_SSL=true
   MINIO_ACCESS_KEY=...
   MINIO_SECRET_KEY=...
   MINIO_BUCKET=...

   # Email: a real provider; Mailhog is local-only
   SMTP_HOST=...
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=...
   SMTP_PASS=...
   SMTP_FROM=noreply@example.com
   CONTACT_INBOX_EMAIL=hello@example.com

   # Billing
   PADDLE_API_KEY=...
   PADDLE_WEBHOOK_SECRET=...
   PADDLE_ENVIRONMENT=production   # or sandbox
   PADDLE_PRODUCT_*=...             # all product and price IDs from .env.example
   PADDLE_PRICE_*=...

   GOOGLE_CLIENT_ID=...
   ```

   If you use a customer site's own domain to embed the widget, that domain doesn't need to be in `CORS_ORIGINS`. The widget calls the API from the widget's origin inside the iframe.

   **Optional:** `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, the `LANGSMITH_*` vars, and the `RAG_*`, `KB_*` and `AI_QUERY_*` tuning flags. Their defaults are fine to start with.
4. If you chose a Render Disk in step 2: **Advanced → Add Disk**, mount path `/app/uploads` (Node runtime: `/var/data` plus `STORAGE_LOCAL_PATH=/var/data/uploads`), and start at 5 to 10 GB. You can grow a disk later but never shrink it.
5. Click **Deploy Web Service**.

**What happens on boot:** [apps/api/docker-entrypoint.sh](apps/api/docker-entrypoint.sh) runs `node dist/scripts/migrate.js` (index sync plus any pending data migrations) **before** the server starts. If a migration fails, the container exits and the deploy fails instead of serving traffic against the wrong schema. You don't need a Render pre-deploy command. To skip migrations for one deploy, set `SKIP_DB_MIGRATE=1`, then remove it afterwards.

**Check it:** once the deploy is live, the logs should contain `[entrypoint] running database migrations…`, then `[entrypoint] starting API server…`, then `[jobs] scheduling background jobs`. Then:

```bash
curl https://resolve-ai-api.onrender.com/health
```

Finally, open **Settings → Scaling** and make sure the service is at **1 instance with autoscaling off**.

---

## Step 7: Deploy the frontends

Create each of these as **New → Web Service → Docker**, using the shared settings from step 5. They can build at the same time.

### 7.1 Web (`resolve-ai-web`)

- Dockerfile Path: `apps/web/Dockerfile`
- Health Check Path: `/api/health`
- Instance Type: Starter

```bash
PORT=3000

# Baked into the bundle at build time
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
NEXT_PUBLIC_SOCKET_URL=https://api.example.com
NEXT_PUBLIC_WIDGET_URL=https://widget.example.com
NEXT_PUBLIC_EMBED_URL=https://embed.example.com/widget.js
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXT_PUBLIC_APP_NAME=ResolveAI
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=...
NEXT_PUBLIC_PADDLE_ENV=production   # or sandbox
NEXT_PUBLIC_PADDLE_PRODUCT_*=...     # all product and price IDs from .env.example
NEXT_PUBLIC_PADDLE_PRICE_*=...

# Runtime
NEXTAUTH_URL=https://app.example.com
NEXTAUTH_SECRET=<from step 4>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
EMBED_BASE_URL=https://embed.example.com
```

Optional Sentry: `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, which are baked in at build time, plus `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` for source-map upload. Render passes **every** env var into the build as a build arg, so the auth token is visible during the build. The web Dockerfile only uses it in the build stage, so it never reaches the final image.

### 7.2 Admin (`resolve-ai-admin`)

- Dockerfile Path: `apps/admin/Dockerfile`
- Health Check Path: `/login`
- Instance Type: Starter

```bash
PORT=3003
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
NEXT_PUBLIC_SOCKET_URL=https://api.example.com
NEXT_PUBLIC_APP_NAME=ResolveAI

NEXTAUTH_URL=https://admin.example.com
ADMIN_NEXTAUTH_URL=https://admin.example.com
NEXTAUTH_SECRET=<from step 4>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Web and admin need **different** `NEXTAUTH_URL` values, each pointing at its own domain.

### 7.3 Widget (`resolve-ai-widget`)

- Dockerfile Path: `apps/widget/Dockerfile`
- Health Check Path: `/api/health`
- Instance Type: Starter

```bash
PORT=3001
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
NEXT_PUBLIC_SOCKET_URL=https://api.example.com
NEXT_PUBLIC_APP_NAME=ResolveAI
NEXT_PUBLIC_APP_URL=https://app.example.com
```

### 7.4 Embed (`resolve-ai-embed`)

- Dockerfile Path: `apps/embed/Dockerfile`
- Health Check Path: `/widget.js`
- Instance Type: Starter. Free also works, since it's a single cached file, but the first visitor after a quiet spell waits for a cold start.

```bash
PORT=80
VITE_WIDGET_URL=https://widget.example.com
VITE_API_URL=https://api.example.com
```

`PORT=80` matters: the image runs nginx on port 80, and without it Render looks for the app on its default port 10000. The nginx config ([apps/embed/nginx.conf](apps/embed/nginx.conf)) already sets the CORS and cache headers that `widget.js` needs.

> **Alternative: a Render Static Site** (the way to go if you use the Node runtime, since the embed has no Node server). `widget.js` is just a static file, so you could serve it from a free Static Site with the build command `pnpm install --frozen-lockfile --prod=false --filter @csb/embed && pnpm --filter @csb/embed build`, publish directory `apps/embed/dist`, the `VITE_*` vars above, and two custom headers on `/widget.js`: `Access-Control-Allow-Origin: *` and `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=86400`. This route hasn't been tested on this repo. The Docker service above uses the same image as every other deployment target.

---

## Step 8: Wire up the external services

Once every service is live:

1. **Google OAuth** (Google Cloud Console → Credentials → your OAuth client):
   - Authorized JavaScript origins: `https://app.example.com` and `https://admin.example.com`
   - Authorized redirect URIs: `https://app.example.com/api/auth/callback/google` and `https://admin.example.com/api/auth/callback/google`
2. **Paddle** (Developer Tools → Notifications): add a destination pointing at `https://api.example.com/api/v1/billing/webhook`. Put the secret Paddle shows you into `PADDLE_WEBHOOK_SECRET` on the API service. Add your web domain under Checkout → Website approval. Sandbox and production are separate Paddle accounts, so see [RUNBOOK §13](RUNBOOK.md#13-paddle-billing--sandbox-vs-production).
3. **CORS:** if any final URL differs from what you put in the API's `CORS_ORIGINS`, fix it there and redeploy the API.

---

## Step 9: Add custom domains

Skip this step if you're staying on `onrender.com` URLs.

1. For each service, open **Settings → Custom Domains → Add Custom Domain** and enter its domain (for example `api.example.com` on `resolve-ai-api`).
2. Render shows the DNS record to create, usually a `CNAME` pointing at `<service>.onrender.com`. Add it at your DNS provider. If you use Cloudflare, set the record to **DNS only** (grey cloud) until Render has verified it.
3. Click **Verify**. Render issues the TLS certificate on its own.
4. If you built the frontends with `onrender.com` URLs and now switch to custom domains, update every `NEXT_PUBLIC_*`, `VITE_*`, `NEXTAUTH_URL`, `CORS_ORIGINS`, `API_BASE_URL`, `WEB_INTERNAL_URL` and `EMBED_BASE_URL` value, then **rebuild** each frontend. The old URLs are baked into the bundles.

WebSockets need no extra setup. Render web services accept WebSocket upgrades, so `NEXT_PUBLIC_SOCKET_URL` can point straight at the API's `https://` URL.

---

## Step 10: Create the first admin

The database starts empty.

1. Sign up at `https://app.example.com`.
2. Promote that account to platform admin. From your machine, with `MONGODB_URI` pointing at Atlas:
   ```bash
   mongosh "$MONGODB_URI" --eval 'db.users.updateOne({ email: "you@example.com" }, { $set: { role: "platform_admin" } })'
   ```
   Atlas's web Data Explorer works too: set `role` to `platform_admin` on that user's document.
3. Sign in at `https://admin.example.com/login`.

Optional seed data, such as the LTD coupons, can be run from the API service's **Shell** tab on a paid plan. See [RUNBOOK §5.2](RUNBOOK.md#52-seed-ltd-coupons-optional) for the commands.

---

## Step 11: Smoke test

| Check | How | Expected |
|---|---|---|
| API is up | `curl https://api.example.com/health` | 200 |
| Web is up | `curl https://app.example.com/api/health` | 200 |
| Widget is up | `curl https://widget.example.com/api/health` | 200 |
| Embed serves the loader | `curl -I https://embed.example.com/widget.js` | 200 with `access-control-allow-origin: *` |
| Admin login page | open `https://admin.example.com/login` | page loads |
| Sign-in | Google and email/password on web | lands on `/checkout` or `/app` |
| Live chat | embed the widget on a test page (see [RUNBOOK §7](RUNBOOK.md#7-try-the-embed-widget-on-a-test-page)), send a message, reply from the dashboard | messages appear both ways without a refresh |
| Uploads survive a deploy | attach a file in the widget, redeploy the API, open the file again | still loads |
| Jobs are running | API logs after boot, then add a website URL as a KB source | `[jobs] scheduling background jobs` once, then the source moves from `pending` to `synced` within a few minutes |

If the live chat check fails, open the browser devtools Network tab and look for the `socket.io` request. A CORS error means `CORS_ORIGINS` is wrong. A connection to `localhost:4000` means that frontend was built without `NEXT_PUBLIC_SOCKET_URL`, so set it and rebuild.

---

## Ongoing operations

- **Auto-deploy:** by default each service redeploys when `main` changes. A push that touches only one app still rebuilds all five. To avoid that, set **Build Filters** (Settings → Build & Deploy) on each service: include paths `apps/<app>/**`, `packages/**`, `pnpm-lock.yaml` and `package.json` (the API doesn't use `packages/ui`, so it can leave that out). The embed only needs `apps/embed/**` and `pnpm-lock.yaml`.
- **Deploy order for breaking API changes:** deploy the API first, then the frontends.
- **Rollbacks:** Events tab → pick an earlier deploy → **Rollback**. Rolling the API back doesn't undo database migrations.
- **Logs:** each service's Logs tab. Turn on Sentry for alerts on top of that.
- **Scaling:** web, admin, widget and embed can each go up in instance count. The API can only go up in instance **type** (see [the rules above](#before-you-start-two-rules-for-this-stack)).
- **Backups:** Atlas handles MongoDB snapshots on M10 and above (and PITR if you enable it). Render Disk snapshots are taken daily. R2 and S3 buckets aren't backed up by default, so turn on versioning if you need it.

## Rough monthly cost

Five paid services: four Starter frontends at about $7 each, plus the API on Starter ($7) or Standard ($25). That comes to about **$35 to $55 a month on Render**, plus Atlas (free M0 for testing, about $57 for M10) and storage (R2's free tier covers small installs). Check [render.com/pricing](https://render.com/pricing) for current numbers.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Deploy fails right after "running database migrations" | Migration error, or Atlas rejected the connection | Read the log line above it. Check Atlas Network Access and `MONGODB_URI`. |
| API deploy fails with `Missing required env var: <NAME>` | A required variable from step 6 is missing | Add it and redeploy. |
| `CREDENTIALS_ENCRYPTION_KEY must be exactly 32 bytes` | The key isn't 64 hex characters | Regenerate it with `openssl rand -hex 32`. |
| Frontend calls `localhost:4000` | `NEXT_PUBLIC_*` not set when the image was built | Set it and choose **Save, rebuild, and deploy**. |
| Health check keeps failing and the deploy times out | `PORT` doesn't match the port the app listens on | Use the `PORT` values from the table at the top. |
| Google sign-in shows `redirect_uri_mismatch` | Callback URL missing in Google Console | Add the exact URLs from step 8. |
| Admin sign-in bounces back to web, or the reverse | Both apps share a `NEXTAUTH_URL` | Give each service its own domain in `NEXTAUTH_URL`. |
| Uploaded files disappear after a deploy | No storage configured, so the API wrote to the ephemeral filesystem | Set the `MINIO_*` vars or attach a disk (step 2). |
| Node runtime: build fails with `tsc: not found` or a missing module | devDependencies were skipped because `NODE_ENV=production` | Add `--prod=false` to `pnpm install` (see [Option B](#option-b-node-runtime-no-docker)). |
| Node runtime: `cp: cannot create directory '.next/standalone/apps/<app>/.next/static'` | `next build` traced from the wrong root, so the standalone output landed elsewhere | Set `NEXT_OUTPUT_FILE_TRACING_ROOT=/opt/render/project/src` and rebuild. |
| Node runtime: `ERR_PNPM_NO_SCRIPT Missing script: start` | Start command is `pnpm start` at the repo root, which has no `start` | Use the per-app start command from Option B. |
| Some users stop receiving live messages | The API is running more than one instance | Set the instance count to 1 (Settings → Scaling). |
